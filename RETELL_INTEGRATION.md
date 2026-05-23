# Retell integration — setup guide

End-to-end checklist for wiring a Retell agent into the Ringr backend. Assumes
the backend is deployed at `https://api.ringr.ca` (replace with your real URL).

**Identity model: no OTP.** The caller is identified by `call.from_number`,
which Retell sends automatically. The backend upserts a Customer on the first
tool call. There are no `send_otp` or `verify_otp` tools — drop them from
your Retell agent if you had them.

## 1. Register your agent in the database

Every Retell agent must be mapped to a tenant by its `agent_id`. Pick one
approach:

### Option A — via the admin API (preferred)

```bash
# Get an admin JWT first
curl -X POST https://api.ringr.ca/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ringr.ca","password":"<your-admin-password>"}'

# Then register the agent. Replace <tenant_id> with the Ringr tenant id and
# <retell_agent_id> with the real id from Retell's dashboard.
curl -X POST https://api.ringr.ca/api/v1/admin/tenants/<tenant_id>/retell-agents \
  -H 'Authorization: Bearer <admin_jwt>' \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"<retell_agent_id>"}'
```

### Option B — edit the seed and re-run it (dev only)

Open `prisma/seed.ts`, change `agentId: 'ringr-agent-demo'` to your real
Retell agent id, then `npx prisma db seed`. Production: never run the seed.

## 2. Set the webhook secret

Generate a strong random string and set it as the env var the backend reads
to verify Retell's HMAC signatures:

```
RETELL_WEBHOOK_SECRET=<random_64_char_hex_string>
```

Put the same value in Retell's dashboard as the webhook signing secret. In
production the backend rejects any unsigned/wrongly-signed webhook. In demo
mode (`DEMO_MODE=true`) HMAC is skipped — never enable demo mode in prod.

## 3. Configure Retell — webhook URL

```
POST https://api.ringr.ca/api/v1/voice/webhook
```

Handles three lifecycle events:

- `call_started` — eagerly upserts the customer + creates a `CallSession`
- `call_ended` — attaches transcript + duration to the `CallSession`
- `call_analyzed` — attaches the AI's call summary

The backend never throws from the webhook handler — even on internal error
it logs and returns `{ received: true }`. Retell never sees retries.

## 4. Configure Retell — tools (four of them)

All tools use the same auth (HMAC via webhook secret). Retell sends
`agent_id` in the body so the backend resolves the tenant automatically.

> **All tool responses are returned RAW** — they bypass the global API
> envelope. Retell tools can read top-level fields directly (e.g.
> `options[0].slot_id`, `subjects[0].subject_id`) without unwrapping
> a `data:` object.

### Tool 1: `get_subjects`

```
POST https://api.ringr.ca/api/v1/voice/tools/get-subjects
```

**Request body** (Retell sends `call` automatically):
```json
{
  "call": { "call_id": "...", "agent_id": "...", "from_number": "+14165551234" },
  "phone": "+14165551234"
}
```

`phone` is optional — backend falls back to `call.from_number` if absent.

**Response (subjects exist)**:
```json
{
  "result": "Found 2 record(s): Buddy (dog), Luna (cat). Which one is this visit for?",
  "subjects": [
    { "subject_id": "subj-aaa", "name": "Buddy", "type": "dog" },
    { "subject_id": "subj-bbb", "name": "Luna",  "type": "cat" }
  ]
}
```

**Response (no records on file)**:
```json
{
  "result": "I don't have any records on file for you yet. Could you tell me your pet's name and what kind of animal they are?",
  "subjects": []
}
```

**Description for the AI**: "Check what records the caller has on file
(pets, vehicles). If results exist, ask which one this visit is for and
**save the chosen `subject_id` for `confirm_booking`**. If empty, ask
the caller for the details so we can create one."

---

### Tool 2: `find_providers`

```
POST https://api.ringr.ca/api/v1/voice/tools/find-providers
```

**Request body**:
```json
{
  "call": { ... },
  "postal_code": "M5H 1J9",
  "vertical_slug": "veterinary",
  "preferred_date": "2026-06-15"
}
```

**Response (found)**:
```json
{
  "result": "I found 3 provider(s) near M5H 1J9. Option 1: Downtown Animal Hospital at 123 King St W, Toronto — 0.4 km away. Available Monday, June 15, 9:00 AM. ... Which would you prefer?",
  "options": [
    {
      "slot_id": "slot-xyz1",
      "provider_id": "prov-vet-1",
      "provider_name": "Downtown Animal Hospital",
      "address": "123 King St W",
      "city": "Toronto",
      "distance_km": 0.42,
      "starts_at": "2026-06-15T13:00:00.000Z"
    }
  ]
}
```

**Response (none)**:
```json
{
  "result": "I couldn't find any available providers near that postal code for that date. Could you try a nearby postal code or a different date?",
  "options": []
}
```

**Description**: "Find the closest available providers within 25 km of the
caller's postal code. `vertical_slug` is REQUIRED — pass `veterinary`,
`dental`, or `automotive` (shorthand like `vet`/`dentist`/`auto` is also
accepted). Without it you might book a pet at a dentist. **Save the chosen
option's `slot_id` to pass into `hold_slot`.**"

**Vertical slug aliases** (case-insensitive):
- `veterinary` ← vet, vets, veterinarian
- `dental` ← dentist, dentistry, teeth
- `automotive` ← auto, car, garage, mechanic, mechanical

---

### Tool 3: `hold_slot`

```
POST https://api.ringr.ca/api/v1/voice/tools/hold-slot
```

**Request body**:
```json
{
  "call": { ... },
  "slot_id": "slot-xyz1"
}
```

The backend identifies the caller from `call.from_number`. A `customer_id`
field is accepted for back-compat but ignored.

**Response (held)**:
```json
{
  "result": "I have held that slot at Downtown Animal Hospital for Monday, June 15, 9:00 AM. You have 10 minutes to confirm. Shall I go ahead and book it?",
  "slot_id": "slot-xyz1",
  "expires_at": "2026-06-15T13:10:00.000Z"
}
```

**Response (slot taken)**:
```json
{
  "result": "Sorry, that slot was just taken by someone else. Let me find you another option.",
  "slot_id": null
}
```

**Description**: "Reserve the chosen slot for 10 minutes. If we don't
confirm in that window the slot auto-releases. **Always hold before
`confirm_booking`.**"

---

### Tool 4: `confirm_booking`

```
POST https://api.ringr.ca/api/v1/voice/tools/confirm-booking
```

**Request body**:
```json
{
  "call": { ... },
  "slot_id": "slot-xyz1",
  "subject_id": "subj-aaa",
  "notes": "annual checkup",
  "extra_fields": { "petSpecies": "dog" }
}
```

`subject_id` is optional — new customers with no records on file simply
omit it. `notes` and `extra_fields` are also optional.

**Response (confirmed)**:
```json
{
  "result": "Your appointment at Downtown Animal Hospital is confirmed for Monday, June 15, 9:00 AM. You will receive a confirmation SMS shortly. Is there anything else I can help you with?",
  "booking_id": "book-zzz999",
  "slot_id": "slot-xyz1"
}
```

**Response (hold expired)**:
```json
{
  "result": "It looks like the hold on that slot just expired. Let me find you another available time.",
  "booking_id": null,
  "slot_id": "slot-xyz1"
}
```

**Description**: "Finalize the booking. After this fires the customer gets
a confirmation SMS and the provider sees the appointment. The slot must
have been held by `hold_slot` first — if the hold has expired we'll tell
you so you can search again."

## 5. Recommended agent system prompt

Drop this (lightly edited) into your Retell agent's system prompt:

```
You are Ringr's appointment booking assistant. You take inbound calls and
book appointments at the nearest available provider for the caller's needs.

You serve three service types: veterinary clinics, dental practices, and
automotive service shops. Your FIRST job on every call is to figure out
which the caller needs.

You do NOT need to verify the caller — their phone number is automatically
included in every tool call and identifies them.

CALL FLOW:
1. Greet warmly. Ask what type of service they need.
   Map their answer to one of: "veterinary", "dental", "automotive".
2. Call get_subjects to see what records they have on file.
3. If get_subjects returned subjects: ask which one this visit is for and
   save its subject_id. If empty: ask for the new record's details (e.g.
   "What's your pet's name and what kind of animal are they?") — you'll
   pass the details as notes or extra_fields on confirm_booking.
4. Ask for their postal code or full address — extract the postal code.
5. Ask for a preferred date if not already mentioned. Default to today.
6. Call find_providers with postal_code, vertical_slug, preferred_date.
7. Read the top 2-3 options conversationally — provider name, distance,
   earliest available time. Ask which they prefer.
8. Save the chosen option's slot_id.
9. Call hold_slot with that slot_id.
10. Recap the booking out loud (provider, time, what it's for) and ask
    for confirmation.
11. On confirmation, call confirm_booking with slot_id, subject_id (if
    they have one on file), and any notes.
12. Confirm the SMS is on its way and wrap up politely.

RULES:
- Never read internal IDs aloud (slot_id, subject_id, call_id).
- If a tool returns an error string, apologize, explain briefly, and
  offer to try again.
- Keep your sentences short — you're on a phone call, not writing prose.
- Always confirm critical details (date/time, provider name, what the
  visit is for) before calling confirm_booking.
```

## 6. Test the round trip (curl)

```bash
# 1. Generate an HMAC for a test call_started event
SECRET='<your_webhook_secret>'
AGENT='<your_real_agent_id_OR_ringr-agent-demo>'
BODY="{\"event\":\"call_started\",\"call\":{\"call_id\":\"test_001\",\"agent_id\":\"$AGENT\",\"from_number\":\"+14165551234\"}}"
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

# 2. Fire the webhook
curl -X POST https://api.ringr.ca/api/v1/voice/webhook \
  -H "Content-Type: application/json" \
  -H "x-retell-signature: $SIG" \
  -d "$BODY"
# Expect: { "received": true } and a new CallSession + Customer row.

# 3. Make a real test call from your own phone. Watch backend logs for
#    tool calls in sequence and the booking-confirmation SMS arriving.
```

In demo mode (`DEMO_MODE=true`) HMAC verification is skipped, so you can
skip step 1 and just POST the body.

## 7. Production env checklist

- [ ] `RETELL_WEBHOOK_SECRET` set on the backend AND matches Retell's dashboard.
- [ ] Your real agent's `agent_id` registered via `POST /admin/tenants/.../retell-agents`.
- [ ] `DEMO_MODE=false` (otherwise HMAC is skipped, geo returns Toronto coords, SMS is logged not sent).
- [ ] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` set.
- [ ] Twilio A2P 10DLC registered if sending SMS to US numbers.
- [ ] `GOOGLE_MAPS_API_KEY` set (or accept that demo coords will be used).
- [ ] `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` are long random strings.
- [ ] DB credentials rotated from the seed baseline.

## 8. Known sharp edges

- **No retry on outbound SMS.** The booking-confirmation SMS goes through a
  Bull queue; if Twilio is down the job retries 3× with backoff and then
  silently fails. Customer-facing outage is invisible without alerting.
- **call_started can race tool calls.** Retell may fire a tool before its
  own `call_started` webhook lands, in which case the CallSession is created
  later and any tool-side customer-resolution still works (it doesn't depend
  on the session). Booking ends up with no CallSession link — schema allows
  it but worth tracking.
- **Caller spoofing.** Without OTP, anyone who can spoof Caller-ID can
  impersonate a customer (list their subjects, book on their behalf). This
  is a deliberate UX-for-security tradeoff. Carrier spoofing is harder than
  it sounds but not impossible — keep this in mind for high-risk verticals.
