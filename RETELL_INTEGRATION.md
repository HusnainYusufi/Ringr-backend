# Retell integration — setup guide

End-to-end checklist for wiring a Retell agent into the Ringr backend. Assumes
the backend is deployed at `https://api.ringr.ca` (replace with your real URL).

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
production the backend will reject any unsigned/wrongly-signed webhook (we
made it fail-closed in Phase 0).

## 3. Configure Retell — webhook URL

In your Retell agent settings, set the call-lifecycle webhook URL to:

```
POST https://api.ringr.ca/api/v1/voice/webhook
```

This endpoint receives `call_started`, `call_ended`, and `call_analyzed`
events. The backend stores the call as a `CallSession`, then on `call_ended`
attaches the transcript and duration.

## 4. Configure Retell — tools

Add six custom tools to the agent. All use the same auth (HMAC via webhook
secret); Retell sends `agent_id` in the body so the backend resolves the
tenant automatically.

> **All tool responses are returned RAW** — they bypass the global API
> envelope. Retell tools can read top-level fields directly (e.g. `customer_id`,
> `options[0].slot_id`) without unwrapping a `data:` object.

### Tool 1: `send_otp`

```
POST https://api.ringr.ca/api/v1/voice/tools/send-otp
```

**Request body** (Retell sends `call` automatically):
```json
{
  "call": { "call_id": "...", "agent_id": "...", "from_number": "+1416..." },
  "phone": "+14165551234"
}
```

**Response**:
```json
{ "result": "A verification code has been sent to ..." }
```

**Description for the AI**: "Send a 6-digit verification code by SMS to the
caller's phone number. Always use this before booking — we need to verify
they have access to the number."

---

### Tool 2: `verify_otp`

```
POST https://api.ringr.ca/api/v1/voice/tools/verify-otp
```

**Request body**:
```json
{
  "call": { ... },
  "phone": "+14165551234",
  "code": "123456"
}
```

**Response (success)**:
```json
{
  "result": "Verified. Welcome back, Alex!",
  "customer_id": "cust-abc123",
  "is_new_customer": false
}
```

**Response (bad code)**:
```json
{ "result": "The code didn't match. Please ask the caller to double-check the SMS and try again." }
```

**Description**: "Validate the code the caller reads back. On success the
caller is identified (existing customer) or auto-registered (new customer).
**Save `customer_id` from the response — every subsequent tool needs it.**"

---

### Tool 3: `get_subjects`

```
POST https://api.ringr.ca/api/v1/voice/tools/get-subjects
```

**Request body**:
```json
{
  "call": { ... },
  "customer_id": "cust-abc123"
}
```

**Response**:
```json
{
  "result": "Found 2 record(s): Buddy (dog), Luna (cat). Please ask which one this visit is for, or if it's for a new one.",
  "subjects": [
    { "subject_id": "subj-aaa", "name": "Buddy", "type": "dog" },
    { "subject_id": "subj-bbb", "name": "Luna",  "type": "cat" }
  ]
}
```

**Description**: "After OTP verification, check what records the caller has
on file (pets, vehicles, etc.) so we can ask which one this visit is for.
**Save the chosen `subject_id` to pass into `confirm_booking`.**"

---

### Tool 4: `find_providers`

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

**Response**:
```json
{
  "result": "I found 3 provider(s) near M5H 1J9. Option 1: Downtown Animal Hospital at 123 King St W, Toronto — 0.4 km away. Next slot: Monday, June 15, 9:00 AM. ...",
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

### Tool 5: `hold_slot`

```
POST https://api.ringr.ca/api/v1/voice/tools/hold-slot
```

**Request body**:
```json
{
  "call": { ... },
  "slot_id": "slot-xyz1",
  "customer_id": "cust-abc123"
}
```

**Response**:
```json
{
  "result": "I've held that slot for you at Downtown Animal Hospital on Monday, June 15, 9:00 AM. You have 10 minutes to confirm. Shall I go ahead and confirm the booking?",
  "slot_id": "slot-xyz1",
  "expires_at": "2026-06-15T13:10:00.000Z"
}
```

**Description**: "Reserve the slot the caller picked for 10 minutes. If we
don't confirm in that window the slot auto-releases. Always hold before
confirming."

---

### Tool 6: `confirm_booking`

```
POST https://api.ringr.ca/api/v1/voice/tools/confirm-booking
```

**Request body**:
```json
{
  "call": { ... },
  "slot_id": "slot-xyz1",
  "customer_id": "cust-abc123",
  "subject_id": "subj-aaa",
  "notes": "annual checkup",
  "extra_fields": { "petSpecies": "dog" }
}
```

**Response**:
```json
{
  "result": "Your appointment at Downtown Animal Hospital is confirmed for Monday, June 15, 9:00 AM. You'll receive a confirmation SMS shortly.",
  "booking_id": "book-zzz999",
  "slot_id": "slot-xyz1"
}
```

**Description**: "Finalize the booking. After this fires the customer gets
a confirmation SMS and the provider sees the appointment in their dashboard."

## 5. Recommended agent system prompt

Drop this (lightly edited) into your Retell agent's system prompt. It's
written to use all six tools in order.

```
You are Ringr's appointment booking assistant. You take inbound calls and
book appointments at the nearest available provider for the caller's needs.

You serve three service types: veterinary clinics, dental practices, and
automotive service shops. Your FIRST job on every call is to figure out
which the caller needs.

CALL FLOW:
1. Greet warmly. Ask what type of service they need.
   Map their answer to one of: "veterinary", "dental", "automotive".
2. Confirm or ask for their phone number. Call send_otp.
3. Ask them to read back the verification code. Call verify_otp.
4. Note the customer's identity from the verify_otp response.
5. Call get_subjects to see existing records (pets, vehicles).
6. Ask if this visit is for an existing record or new. If new, gather the
   essential details (e.g. "What's your pet's name and species?").
7. Ask for their postal code or full address — extract the postal code.
8. Ask for a preferred date if not already mentioned. Default to today.
9. Call find_providers with postal_code, vertical_slug, and preferred_date.
10. Read the top 2-3 options conversationally — provider name, distance,
    earliest available time. Ask which they prefer.
11. Call hold_slot with the chosen slot's id and the customer's id.
12. Recap the booking out loud (provider, time, what it's for) and ask for
    confirmation.
13. On confirmation, call confirm_booking with slot_id, customer_id,
    subject_id (if applicable), and any notes.
14. Confirm the SMS is on its way and wrap up the call politely.

RULES:
- Never read internal IDs aloud (slot_id, customer_id, agent_id).
- If a tool returns an error string, apologize, explain briefly, and offer
  to try again or transfer to a human.
- Keep your sentences short — you're on a phone call, not writing prose.
- Always confirm critical details (date/time, provider name, what the
  visit is for) before calling confirm_booking.
- If the caller is in a hurry, you can shortcut by asking for postal code
  and service type up-front.
```

## 6. Test the round trip

Before going live:

```bash
# 1. Verify a known agent_id resolves to a tenant
curl -X POST https://api.ringr.ca/api/v1/voice/webhook \
  -H 'Content-Type: application/json' \
  -H 'x-retell-signature: <hmac>' \
  -d '{
    "event": "call_started",
    "call": {
      "call_id": "test_call_001",
      "agent_id": "<your_real_agent_id>",
      "from_number": "+14165551234"
    }
  }'
# Expect 200 with {"received": true}. Check the database for a new CallSession row.

# 2. Make a real test call from your own phone (DEMO_MODE=false).
#    Watch backend logs for OTP send, tool calls, booking confirmation,
#    and the booking.confirmed SMS reaching your phone.
```

## 7. Production env checklist

Before pointing real customer traffic at this:

- [ ] `RETELL_WEBHOOK_SECRET` set (backend rejects unsigned webhooks in production).
- [ ] `RETELL_API_KEY` set (currently unused by the backend, but reserved for outbound Retell calls in a future pass).
- [ ] `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` set.
- [ ] **Twilio A2P 10DLC registered** for the from-number — without this, SMS to most US numbers will be filtered as spam. Canadian SMS does not require A2P but check provincial rules.
- [ ] `SMTP_*` set (nodemailer + Gmail App Password by default).
- [ ] `GOOGLE_MAPS_API_KEY` set if you want real geocoding (else demo coords).
- [ ] `DEMO_MODE=false` (otherwise OTP always accepts `123456`).
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` rotated to long random strings.
- [ ] DB credentials rotated from the leaked baseline.

## Known sharp edges

- **No idempotency on `call_started`** beyond the unique `callId` constraint
  — a retried webhook will surface a 409 in logs rather than a 200. Cosmetic.
- **No retry on outbound SMS**. The booking-confirmation SMS goes via Twilio
  inside a Bull queue; if Twilio is down, the job retries 3× with backoff
  but after that, the customer just doesn't get the SMS. Customer-facing
  failure is silent today. Phase 6b adds a delivery log + redeliver button.
- **call_started can race confirm_booking** in pathological cases — Retell
  may send confirm_booking from a tool call before call_started lands in the
  webhook, leaving a Booking with no associated CallSession. The schema
  allows it (callSession is optional on Booking) but it's worth tracking.
