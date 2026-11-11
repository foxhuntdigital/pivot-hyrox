# App Store listing (draft)

A first draft for App Store Connect, written from what the app actually does
today. Edit freely; the character counts below are checked against Apple's
limits. Fill in anything in [brackets].

> **Check the HYROX name before submitting.** HYROX is a registered trademark.
> Apple rejects apps that use another company's trademark in the **name,
> subtitle or keywords** without permission (guideline 5.2.1), so this draft
> keeps it out of all three. Saying the app trains *for* HYROX races in the
> description is a normal way to describe compatibility, but it can still draw
> a question from review. If Fox Hunt Digital has a licence or partnership with
> HYROX, it can go back into the name and keywords. The app itself also names
> HYROX races (for example "Vegas HYROX · Open" on Today), which falls under the
> same rule.

## Name (30 max)

**PIVOT: Hybrid Race Training** (27)

Alternatives: `PIVOT – Hybrid Fitness Coach` (28), `PIVOT: Adaptive Race Training` (29)

## Subtitle (30 max)

**Your plan adapts to your day** (28)

Alternatives: `Training that bends to you` (27), `Plans that fit your real week` (29)

## Promotional text (170 max, can change without review)

**Race day doesn't move. Your days do. Every session comes in Full, Express and Micro, so a short day still trains what the week needs. Start free for a week.** (156)

## Description (4000 max; this draft is about 2,100)

```
Race day doesn't move. Your days do.

PIVOT builds a training plan around your race date, then adapts it to the day you're actually having: the hour you planned, the twenty minutes you really have, the night you didn't sleep.

FULL, EXPRESS, MICRO
Every session comes in three lengths. What gets cut is volume, never the point of the session, so a short day still delivers the work your week needs.

STIMULUS, NOT SCHEDULE
Your week asks for the right mix of running, station work, strength and engine. A session landing a day late doesn't put you behind, and nothing is ever marked missed.

A COACH THAT KNOWS YOUR PLAN
Ask why today's session is what it is, swap it for something that fits, or change your week in a sentence. Coach reads your plan, your recovery and your equipment before it answers.

BUILT FOR YOUR KIT
Tell PIVOT what you have, from a full gym to a pair of dumbbells, and every session is built from it. When a movement needs equipment you don't have, it's swapped and the swap is shown.

READINESS FROM YOUR OWN TRAINING
Six measures from the sessions you complete and how you report you're recovering, with the confidence behind each one, so you can see what's improving and what's holding you back.

MADE FOR HYBRID RACES
Running, sled, rowing, ski, wall balls, burpees, carries, lunges: PIVOT trains the whole race, for HYROX and other hybrid fitness events, from your first race to your next personal best.

SUBSCRIPTION
PIVOT is a subscription with a free 1-week trial for new subscribers. Payment is charged to your Apple ID when the trial ends unless you cancel at least 24 hours before. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period, and can be managed or cancelled in your Apple ID settings.

Privacy Policy: [privacy policy URL]
Terms of Use: [terms URL, or https://www.apple.com/legal/internet-services/itunes/dev/stdeula/]

PIVOT gives training guidance, not medical advice. Check with a doctor or physio before training if you are injured, pregnant or recently postpartum, or have a medical condition.
```

## Keywords (100 max, comma-separated, no spaces)

**hybrid,fitness,race,training,plan,running,functional,workout,coach,strength,adaptive,emom,sled,row** (98)

Keywords already in the name or subtitle don't need repeating; Apple indexes those separately.

## URLs

- **Support URL:** [a page with a contact email, e.g. https://foxhuntdigital.com/pivot/support]
- **Marketing URL** (optional): [the PIVOT page on the Fox Hunt Digital site]
- **Privacy Policy URL:** [the same page the app links to]

## Category

- **Primary:** Health & Fitness
- **Secondary** (optional): Sports

## Age rating (questionnaire answers)

Answer "None" / "No" throughout, except check these two as they apply:

- **Medical or treatment information:** the app tailors training around injury,
  pregnancy and postpartum status and gives "not medical advice" guidance. That
  is not medical information in Apple's sense; "None" is the expected answer,
  but read the question's current wording.
- **Unrestricted web access / user-generated content:** No. Coach is an AI
  assistant that answers the athlete's own questions; nothing is shared with
  other users. If the questionnaire asks about AI chat or generated content,
  answer it as that.

Expected result: **4+** (or the lowest rating the current questionnaire allows).

## App Review information

**Sign-in required:** Yes. Provide a demo account:

- Email: [demo address, e.g. review@foxhuntdigital.com]
- Password: [password]

Create it on the production build and finish setup with it, so it has a plan.
It must **not** have a subscription, so the reviewer can test the purchase.

**Notes for the reviewer:**

```
PIVOT is an adaptive training app for hybrid fitness races.

The demo account above has already completed setup and has a training plan. On opening the app, it will show the subscription offer, because it has no subscription.

To see the full flow with a new account instead:
1. Tap "New here? Create one" and sign up with any email address. A six-digit confirmation code is emailed; enter it in the app.
2. Go through the short introduction and the seven setup questions.
3. The plan is built and shown ("Your plan is ready"). Tap "Start training".
4. The subscription offer appears here, at the end of setup, after the plan is built. New subscribers get a 1-week free trial.

In-app purchases: an auto-renewable subscription (pivot_engine_pro entitlement), monthly and yearly, each with a 1-week free introductory offer. Restore purchases is on the subscription screen and in Settings › Subscription. Offer codes can be redeemed from "Have a code? Redeem it".

Account deletion: Profile › Account › Delete account. It permanently deletes the account and all its data.

Coach is an AI assistant (Anthropic's Claude) that answers questions about the user's own plan. It gives training guidance, not medical advice, and says so in the app.
```

**Contact:** [name, phone and email App Review can reach during review]
