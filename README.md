# Cadence SMS Bot

Business compliance assistant that runs via SMS (Twilio + Railway).

## Setup

1. Deploy to Railway
2. Add environment variables in Railway:
   - TWILIO_ACCOUNT_SID
   - TWILIO_AUTH_TOKEN
   - TWILIO_PHONE_NUMBER
3. Copy your Railway URL
4. Paste it into Twilio webhook → Messaging → your number → "A message comes in"
5. Text your Twilio number to start

## How it works

User texts the Cadence number → Railway receives it → bot responds with the right message from the onboarding script → user replies → conversation continues.
