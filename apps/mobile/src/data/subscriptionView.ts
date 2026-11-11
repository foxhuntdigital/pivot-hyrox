/**
 * What the Subscription page and the "subscription ended" screen say about a
 * subscription. Pure, so the wording for each state is pinned by tests.
 */
export interface SubscriptionFacts {
  status: 'trialing' | 'active' | 'in_grace' | 'expired' | 'revoked' | 'none';
  active: boolean;
  product_id: string | null;
  store: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  will_renew: boolean;
}

export interface SubscriptionSummary {
  /** One line for the Profile row and the page's heading. */
  headline: string;
  /** What happens next, in a sentence. */
  detail: string;
  /** "Yearly", "Monthly", "Beta access", or null when unknown. */
  plan: string | null;
  /** Billed through Apple, so Apple's own page is where it is changed. */
  managedByApple: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Mar 2027", in the phone's own time zone. Empty for a missing date. */
export function dayLabel(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function planName(productId: string | null): string | null {
  if (!productId) return null;
  if (productId === 'beta_comp') return 'Beta access';
  const id = productId.toLowerCase();
  if (/year|annual|12m/.test(id)) return 'Yearly';
  if (/month|1m\b/.test(id)) return 'Monthly';
  return null;
}

export function describeSubscription(s: SubscriptionFacts): SubscriptionSummary {
  const plan = planName(s.product_id);
  const managedByApple = s.store === 'app_store';
  const end = dayLabel(s.current_period_end);
  const beta = s.product_id === 'beta_comp';

  if (beta && s.active) {
    return {
      headline: 'Beta access',
      detail: end ? `Free until ${end}. Nothing is charged; choose a plan any time before then.`
        : 'Free during the beta. Nothing is charged.',
      plan, managedByApple: false,
    };
  }

  if (s.active) {
    if (s.status === 'in_grace') {
      return {
        headline: 'Payment problem',
        detail: 'Apple could not take the last payment. Update your payment details in the App Store '
          + 'to keep your plan running.',
        plan, managedByApple,
      };
    }
    if (s.status === 'trialing') {
      const trialEnd = dayLabel(s.trial_ends_at ?? s.current_period_end);
      return {
        headline: 'Free trial',
        detail: s.will_renew
          ? `Your trial ends ${trialEnd || 'soon'}, then your plan starts automatically.`
          : `Your trial ends ${trialEnd || 'soon'} and will not renew.`,
        plan, managedByApple,
      };
    }
    return {
      headline: s.will_renew ? 'Active' : 'Cancelled',
      detail: s.will_renew
        ? (end ? `Renews ${end}.` : 'Renews automatically.')
        : (end ? `You keep full access until ${end}. It will not renew.` : 'It will not renew.'),
      plan, managedByApple,
    };
  }

  if (s.status === 'revoked') {
    return {
      headline: 'Refunded',
      detail: 'This subscription was refunded, so it no longer gives access.',
      plan, managedByApple,
    };
  }
  if (s.status === 'none') {
    return {
      headline: 'No subscription',
      detail: 'Choose a plan to keep training with PIVOT.',
      plan: null, managedByApple: false,
    };
  }
  return {
    headline: beta ? 'Beta access ended' : 'Ended',
    detail: end ? `Your access ended ${end}. Choose a plan to pick up where you left off.`
      : 'Choose a plan to pick up where you left off.',
    plan, managedByApple,
  };
}
