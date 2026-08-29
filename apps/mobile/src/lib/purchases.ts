/**
 * RevenueCat, wrapped.
 *
 * Two rules shape everything here.
 *
 * **The app user id must be `public.users.id`.** RevenueCat sends webhooks
 * keyed on it, and `revenuecat-webhook` looks the athlete up by that value. Get
 * this wrong and every purchase succeeds on the device and grants nothing on
 * the server, which is the worst possible failure: the athlete is charged and
 * still locked out.
 *
 * **The SDK's answer is not the source of truth.** It knows what StoreKit just
 * did; the server knows what has been paid for, including refunds Apple clawed
 * back after the fact. So a purchase here is followed by a server read, and the
 * Edge Functions gate on the server's answer regardless of what the device
 * believes.
 */
import { NativeModules, Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
} from 'react-native-purchases';

/** The entitlement configured in RevenueCat. Must match the webhook's. */
export const ENTITLEMENT_ID = 'pivot_engine_pro';

/** Offering package identifiers, as configured in the RevenueCat dashboard. */
export const PACKAGES = { yearly: 'yearly', monthly: 'monthly' } as const;

/**
 * Public SDK keys are meant to ship in the client — they can only read
 * offerings and start purchases — but they still come from the environment so
 * a build can be pointed at a different project without a code change.
 *
 * A `test_` key is RevenueCat's Test Store: it simulates purchases without
 * App Store Connect, which is right for development and wrong for release.
 * `isTestStore` exists so the UI can say so rather than looking real.
 */
const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '';
const API_KEY = Platform.select({ ios: IOS_KEY, android: ANDROID_KEY, default: '' }) ?? '';

export const isTestStore = API_KEY.startsWith('test_');

/**
 * Whether this binary actually contains the RevenueCat native module.
 *
 * The JS bundle and the native shell move independently: a dev client built
 * before the subscription work happily loads today's bundle, and Expo Go never
 * has custom native code at all. The SDK only half-defends against that:
 * `isConfigured()` returns false with a warning, while `setLogLevel()` calls
 * straight through and dies with "Cannot read property 'setLogLevel' of null".
 *
 * Checking here puts a stale build on the same path as a build with no API key:
 * purchases unavailable, the trial screen's fallback, no crash. Wrong only in
 * the sense that the athlete cannot buy anything — which is true, and is what
 * they should be shown.
 */
const hasNativeModule = !!NativeModules.RNPurchases;

if (__DEV__ && API_KEY.length > 0 && !hasNativeModule) {
  console.warn(
    '[purchases] RevenueCat key is set but the native module is missing from '
    + 'this build — rebuild the dev client (npm run ios) to exercise purchases. '
    + 'Running without them.');
}

export const isPurchasesConfigured = () => API_KEY.length > 0 && hasNativeModule;

let configuredFor: string | null = null;

/**
 * Configures the SDK, or re-identifies it when the signed-in athlete changes.
 *
 * Safe to call on every session change: configuring twice is a no-op, and a
 * different athlete goes through `logIn` so their purchases are not attributed
 * to the previous account on a shared device.
 */
export async function configurePurchases(userId: string | null): Promise<void> {
  if (!isPurchasesConfigured()) return;

  if (!(await Purchases.isConfigured())) {
    // Awaited, not fired and forgotten: every one of these SDK calls returns a
    // promise, and an unawaited one that rejects surfaces as an unhandled
    // rejection in a red box rather than through this function's own caller,
    // which already handles failure.
    if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.WARN);
    // Configuring with the athlete's id up front avoids creating an anonymous
    // RevenueCat user that then has to be merged.
    Purchases.configure({ apiKey: API_KEY, appUserID: userId ?? undefined });
    configuredFor = userId;
    return;
  }

  if (userId && configuredFor !== userId) {
    await Purchases.logIn(userId);
    configuredFor = userId;
  } else if (!userId && configuredFor) {
    await Purchases.logOut();
    configuredFor = null;
  }
}

/** True when the SDK currently believes the entitlement is active. */
export function hasEntitlement(info: CustomerInfo | null): boolean {
  return !!info?.entitlements.active[ENTITLEMENT_ID];
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isPurchasesConfigured()) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

/**
 * The current offering, or null when none is configured.
 *
 * Null is a real state, not an error: a project with no offering set up yet
 * returns nothing, and the caller shows its own screen rather than an empty
 * paywall.
 */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!isPurchasesConfigured()) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch {
    return null;
  }
}

export type PurchaseOutcome =
  | { kind: 'purchased'; info: CustomerInfo }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

/**
 * Buys a package from the current offering.
 *
 * A user cancelling is not an error and must not be reported as one — it is
 * the most common outcome on any paywall.
 */
export async function purchase(packageId: string): Promise<PurchaseOutcome> {
  if (!isPurchasesConfigured()) return { kind: 'unavailable' };
  try {
    const offering = await getCurrentOffering();
    const pkg = offering?.availablePackages.find(p => p.identifier === packageId);
    if (!pkg) return { kind: 'unavailable' };
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { kind: 'purchased', info: customerInfo };
  } catch (e: any) {
    if (e?.userCancelled) return { kind: 'cancelled' };
    return { kind: 'error', message: e?.message ?? 'Purchase failed.' };
  }
}

export async function restore(): Promise<PurchaseOutcome> {
  if (!isPurchasesConfigured()) return { kind: 'unavailable' };
  try {
    const info = await Purchases.restorePurchases();
    return { kind: 'purchased', info };
  } catch (e: any) {
    if (e?.userCancelled) return { kind: 'cancelled' };
    return { kind: 'error', message: e?.message ?? 'Restore failed.' };
  }
}

/**
 * Runs `fn` whenever RevenueCat's view of the customer changes — a renewal, a
 * restore on another device, a refund. Returns an unsubscribe.
 */
export function onCustomerInfoChange(fn: (info: CustomerInfo) => void): () => void {
  if (!isPurchasesConfigured()) return () => {};
  Purchases.addCustomerInfoUpdateListener(fn);
  return () => Purchases.removeCustomerInfoUpdateListener(fn);
}
