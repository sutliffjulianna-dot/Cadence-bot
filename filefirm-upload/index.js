const express = require("express");
const twilio = require("twilio");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Supabase client ──────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_Url || process.env.supabase_url;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_anon_key || process.env.supabase_anon_key;

console.log("ENV CHECK — SUPABASE_URL:", SUPABASE_URL ? "✓ found" : "✗ MISSING");
console.log("ENV CHECK — SUPABASE_ANON_KEY:", SUPABASE_KEY ? "✓ found" : "✗ MISSING");
console.log("ENV CHECK — TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "✓ found" : "✗ MISSING");
console.log("ENV CHECK — All Railway env keys:", Object.keys(process.env).filter(k => !k.startsWith("npm")).join(", "));

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("FATAL: Supabase environment variables not found. Check Railway variables.");
  console.error("Available env keys:", Object.keys(process.env).join(", "));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── In-memory session cache (Supabase is the source of truth) ────────────
// We cache the current conversation step in memory for speed,
// but all user data is written to and read from Supabase.
const sessionCache = {};

// ── Get or create user from Supabase ────────────────────────────────────
async function getUser(phone) {
  // Check cache first
  if (sessionCache[phone]) return sessionCache[phone];

  // Try to find existing user in Supabase
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("phone", phone)
    .single();

  if (data) {
    sessionCache[phone] = { phone, step: data.onboarding_step || 0, data: data.cadence_data || {} };
    return sessionCache[phone];
  }

  // New user — create record in Supabase
  const newUser = { phone, step: 0, data: {} };
  await supabase.from("members").insert({
    phone,
    onboarding_step: 0,
    cadence_data: {},
    plan: "free",
    signup_source: "text",
    created_at: new Date().toISOString(),
  });

  sessionCache[phone] = newUser;
  return newUser;
}

// ── Save user to Supabase ────────────────────────────────────────────────
async function saveUser(user) {
  sessionCache[user.phone] = user;
  await supabase
    .from("members")
    .update({
      onboarding_step: user.step,
      cadence_data: user.data,
      // Pull key fields up to top-level columns for easy admin viewing
      first_name: user.data.name || null,
      business_name: user.data.businessName || null,
      state: user.data.state || null,
      entity_type: user.data.entityType || null,
      registration_date: user.data.registrationDate || null,
      last_active: new Date().toISOString(),
    })
    .eq("phone", user.phone);
}

// ── SMS reply helper ─────────────────────────────────────────────────────
function reply(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.type("text/xml").send(twiml.toString());
}

// ── Send outbound SMS ────────────────────────────────────────────────────
async function sendSMS(to, message) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return client.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: `+1${to}`
  });
}

// ── Tax savings estimate ─────────────────────────────────────────────────
function getTaxEstimate(revenueRange) {
  const estimates = {
    "1": { low: 500,   high: 1000  },
    "2": { low: 1000,  high: 1500  },
    "3": { low: 1500,  high: 2500  },
    "4": { low: 2500,  high: 6250  },
    "5": { low: 6250,  high: 12500 },
    "6": { low: 1500,  high: 4000  },
  };
  return estimates[revenueRange] || { low: 1000, high: 3000 };
}

// ── State annual report dates ────────────────────────────────────────────
const stateReports = {
  "alabama": "March 15 (Business Privilege Tax — AL Dept of Revenue)",
  "alaska": "January 2 every 2 years (Biennial Report — $100 fee)",
  "arizona": "not required for LLCs",
  "arkansas": "May 1 (Annual Franchise Tax Report)",
  "california": "by your anniversary date (Statement of Information — $25 fee)",
  "colorado": "by your anniversary date (Periodic Report — $10 fee)",
  "connecticut": "March 31 (Annual Report — $80 fee)",
  "delaware": "June 1 (Annual Report — $300 fee for corps)",
  "florida": "May 1 (Annual Report — $138.75 fee)",
  "georgia": "April 1 (Annual Registration — $50 fee)",
  "hawaii": "by your anniversary date (Annual Report — $15 fee)",
  "idaho": "by your anniversary month (Annual Report — no fee)",
  "illinois": "before your anniversary date (Annual Report — $75 fee)",
  "indiana": "every 2 years by anniversary date (Biennial Report — $32 fee)",
  "iowa": "April 1 every 2 years (Biennial Report — $60 fee)",
  "kansas": "April 15 (Annual Report — $55 fee)",
  "kentucky": "June 30 (Annual Report — $15 fee)",
  "louisiana": "by your anniversary date (Annual Report — $35 fee)",
  "maine": "June 1 (Annual Report — $85 fee)",
  "maryland": "April 15 (Annual Report — $300 fee)",
  "massachusetts": "by your anniversary date (Annual Report — $500 fee)",
  "michigan": "February 15 (Annual Statement — $25 fee)",
  "minnesota": "December 31 (Annual Renewal — no fee)",
  "mississippi": "April 15 (Annual Report — no fee)",
  "missouri": "not required for LLCs",
  "montana": "April 15 (Annual Report — $15 fee)",
  "nebraska": "April 1 every 2 years (Biennial Report — $26 fee)",
  "nevada": "by your anniversary month (Annual List — $350 fee)",
  "new hampshire": "April 1 (Annual Report — $100 fee)",
  "new jersey": "by your anniversary month (Annual Report — $75 fee)",
  "new mexico": "by your anniversary date every 2 years (Biennial Report — $25 fee)",
  "new york": "by your anniversary month every 2 years (Biennial Statement — $9 fee)",
  "north carolina": "April 15 (Annual Report — $200 fee)",
  "north dakota": "August 1 (Annual Report — $50 fee)",
  "ohio": "by your anniversary date every 2 years (Biennial Report — $99 fee)",
  "oklahoma": "by your anniversary date (Annual Certificate — $25 fee)",
  "oregon": "by your anniversary date (Annual Report — $100 fee)",
  "pennsylvania": "every 10 years (Decennial Report — $70 fee)",
  "rhode island": "by your anniversary date (Annual Report — $50 fee)",
  "south carolina": "by your anniversary date (Annual Report — no fee)",
  "south dakota": "by your anniversary date (Annual Report — $50 fee)",
  "tennessee": "April 1 (Annual Report — $300 min fee)",
  "texas": "May 15 (Franchise Tax Report — TX Comptroller)",
  "utah": "by your anniversary date (Annual Renewal — $18 fee)",
  "vermont": "March 15 (Annual Report — $45 fee)",
  "virginia": "by your anniversary date (Annual Registration — $50 fee)",
  "washington": "by your anniversary date (Annual Report — $71 fee)",
  "west virginia": "July 1 (Annual Report — $25 fee)",
  "wisconsin": "by end of anniversary quarter (Annual Report — $25 fee)",
  "wyoming": "by your anniversary month (Annual Report — $60 min fee)",
  "washington d.c.": "April 1 every 2 years (Biennial Report — $300 fee)",
};

function getStateReport(state) {
  const key = state.toLowerCase().trim();
  return stateReports[key] || "annually — I'll look up your exact date and send it to you";
}

// ════════════════════════════════════════════════════════════════════════
// WEB SIGNUP ENDPOINT
// ════════════════════════════════════════════════════════════════════════
app.post("/signup", async (req, res) => {
  try {
    const { firstName, phone, state, entityType } = req.body;

    if (!firstName || !phone || !state) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const cleanPhone = phone.replace(/\D/g, "");
    const e164 = `+1${cleanPhone}`;

    // Check if user already exists
    const { data: existing } = await supabase
      .from("members")
      .select("phone")
      .eq("phone", e164)
      .single();

    if (existing) {
      // Already signed up — just re-send welcome
      await sendSMS(cleanPhone,
        `Hey ${firstName}! You're already in FileFirm. Text STATUS to see where your business stands, or HELP if you need anything. — Cadence 🤝`
      );
      return res.json({ success: true, existing: true });
    }

    // Create new member in Supabase
    await supabase.from("members").insert({
      phone: e164,
      first_name: firstName,
      state,
      entity_type: entityType || null,
      onboarding_step: 2,
      cadence_data: { name: firstName, state, entityType: entityType || "business" },
      plan: "free",
      signup_source: "web",
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    });

    // Update session cache
    sessionCache[e164] = {
      phone: e164,
      step: 2,
      data: { name: firstName, state, entityType: entityType || "business" }
    };

    // Send welcome text
    const welcomeMsg =
      `Hey ${firstName}! 👋 I'm Cadence — your FileFirm business assistant.\n\n` +
      `I've got your ${state} ${entityType || "business"} profile started. I'll keep track of your filings, taxes, and deadlines.\n\n` +
      `One quick question to finish your setup:\n\nWhat's the name of your business?`;

    await sendSMS(cleanPhone, welcomeMsg);
    return res.json({ success: true });

  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "Failed to process signup" });
  }
});

// ════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINT — your private view of all members
// ════════════════════════════════════════════════════════════════════════
app.get("/admin/members", async (req, res) => {
  // Simple token check — set ADMIN_TOKEN in Railway variables
  const token = req.query.token;
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ count: data.length, members: data });
});

// ════════════════════════════════════════════════════════════════════════
// SMS WEBHOOK — all incoming texts from users
// ════════════════════════════════════════════════════════════════════════
app.post("/sms", async (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim();
  const input = body.toLowerCase();

  // Handle MMS (photo) — receipt or mail capture
  const hasPhoto = req.body.NumMedia && parseInt(req.body.NumMedia) > 0;
  const photoUrl = hasPhoto ? req.body.MediaUrl0 : null;

  let user;
  try {
    user = await getUser(from);
  } catch (err) {
    console.error("Error getting user:", err);
    return reply(res, "Hey — I'm having a moment. Try texting me again in a minute. 🤝");
  }

  const step = user.step;

  // ── Photo received — file it ─────────────────────────────────────────
  if (hasPhoto) {
    try {
      // Save photo reference to Supabase
      await supabase.from("documents").insert({
        member_phone: from,
        media_url: photoUrl,
        media_type: req.body.MediaContentType0 || "image/jpeg",
        source: "sms",
        status: "received",
        created_at: new Date().toISOString(),
      });

      user.data.lastPhotoReceived = new Date().toISOString();
      await saveUser(user);

      return reply(res,
        `Got it — I've filed that photo. 📎\n\nIs this a receipt or a piece of mail?\n\n1️⃣ Receipt\n2️⃣ Mail or government document\n3️⃣ Something else`
      );
    } catch (err) {
      console.error("Photo save error:", err);
      return reply(res, "Got your photo — having a little trouble filing it right now. Try again in a minute.");
    }
  }

  // ── Photo context — categorize what was just received ────────────────
  if (user.data.lastPhotoReceived && step > 11) {
    const timeSincePhoto = Date.now() - new Date(user.data.lastPhotoReceived).getTime();
    if (timeSincePhoto < 300000) { // Within 5 minutes
      let category = "other";
      if (input === "1" || input.includes("receipt")) category = "receipt";
      else if (input === "2" || input.includes("mail") || input.includes("government")) category = "mail";

      try {
        await supabase.from("documents")
          .update({ category, status: "filed" })
          .eq("member_phone", from)
          .eq("status", "received");

        user.data.lastPhotoReceived = null;
        await saveUser(user);

        const confirmMsg = category === "receipt"
          ? `Filed as a receipt. ✓ I'll categorize it and add it to your records. Text me another anytime.`
          : category === "mail"
          ? `Filed as mail. ✓ I've saved it to your documents. If there's a deadline or action needed, I'll let you know.`
          : `Filed. ✓ I've saved it to your documents.`;

        return reply(res, confirmMsg);
      } catch (err) {
        console.error("Category update error:", err);
      }
    }
  }

  // ── Global keywords (work at any step) ──────────────────────────────
  if (input === "stop") {
    await supabase.from("members").update({ opted_out: true }).eq("phone", from);
    return reply(res, "You've been unsubscribed from FileFirm messages. Reply START anytime to come back.");
  }

  if (input === "start" || input === "unstop") {
    await supabase.from("members").update({ opted_out: false }).eq("phone", from);
    return reply(res, `Welcome back! 👋 Reply HELP to see what I can do, or STATUS to check where your business stands.`);
  }

  if (input === "help") {
    return reply(res,
      `I'm Cadence — your FileFirm business assistant. Here's what I can help with:\n\nSTATUS — see your business snapshot\nTAXES — estimated tax info\nFILING — state filing help\nSend a photo — file a receipt or mail\n\ngetfilefirm.com to see your dashboard.`
    );
  }

  if (input === "status") {
    const reportInfo = user.data.state ? getStateReport(user.data.state) : "unknown";
    return reply(res,
      `Here's where ${user.data.businessName || "your business"} stands:\n\n📋 State: ${user.data.state || "not set"}\n🏢 Entity: ${user.data.entityType || "not set"}\n📅 Annual report: ${reportInfo}\n💰 Tax savings: tracking\n\nNothing urgent right now. I'll text you when something comes up. 🤝`
    );
  }

  if (input === "done" || input === "filed") {
    return reply(res,
      `✓ Marked as done. You won't hear about this again until next time it's due. Nice work, ${user.data.name || "friend"}.`
    );
  }

  // ── ONBOARDING STEPS ─────────────────────────────────────────────────

  // STEP 0: Cold text
  if (step === 0) {
    user.step = 1;
    await saveUser(user);
    return reply(res,
      `Hey, I'm Cadence. 👋\n\nI'm your FileFirm business assistant — I keep track of your taxes, filings, and deadlines so you don't have to stress about them.\n\nI'll only reach out when something needs your attention. No spam, ever.\n\nLet's get you set up — takes about 3 minutes.\n\nWhat's your first name?`
    );
  }

  // STEP 1: Name
  if (step === 1) {
    user.data.name = body;
    user.step = 2;
    await saveUser(user);
    return reply(res, `Nice to meet you, ${user.data.name}! What's the name of your business?`);
  }

  // STEP 2: Business name
  if (step === 2) {
    user.data.businessName = body;
    user.step = 3;

    if (user.data.state && user.data.entityType) {
      user.step = 5;
      await saveUser(user);
      return reply(res,
        `Got it — ${body} is all set in my system.\n\nWhen did you register your business? Approximate month and year is fine.\n\n(Example: March 2021)\n\nIf you haven't registered yet, just reply NOT YET.`
      );
    }

    await saveUser(user);
    return reply(res, `Got it. What state is ${user.data.businessName} registered in?`);
  }

  // STEP 3: State
  if (step === 3) {
    user.data.state = body;
    user.step = 4;
    await saveUser(user);
    return reply(res,
      `What type of business is it? Reply with a number:\n\n1️⃣ LLC\n2️⃣ Sole Proprietor\n3️⃣ S-Corp\n4️⃣ C-Corp\n5️⃣ Partnership\n6️⃣ Not registered yet\n7️⃣ Not sure`
    );
  }

  // STEP 4: Entity type
  if (step === 4) {
    const types = { "1":"LLC","2":"Sole Proprietor","3":"S-Corp","4":"C-Corp","5":"Partnership","6":"Not registered yet","7":"Not sure" };
    user.data.entityType = types[input] || body;
    user.step = 5;
    await saveUser(user);
    return reply(res,
      `When did you register ${user.data.businessName}? Approximate month and year is fine.\n\n(Example: March 2021)\n\nIf you haven't registered yet, just reply NOT YET.`
    );
  }

  // STEP 5: Registration date (anniversary gift data!)
  if (step === 5) {
    user.data.registrationDate = body;
    user.step = 6;

    // Parse and save anniversary date to Supabase
    if (body.toLowerCase() !== "not yet") {
      await supabase.from("members")
        .update({ registration_date: body })
        .eq("phone", from);
    }

    await saveUser(user);
    return reply(res,
      `Have you filed your ${user.data.state} annual report this year?\n\n1️⃣ Yes, I filed it\n2️⃣ No, not yet\n3️⃣ I don't know what that is`
    );
  }

  // STEP 6: Annual report
  if (step === 6) {
    user.data.annualReport = input;
    user.step = 7;
    await saveUser(user);

    if (input === "3" || input.includes("don't know") || input.includes("not sure")) {
      const reportInfo = getStateReport(user.data.state);
      return reply(res,
        `No worries — most people don't know about this.\n\nIn ${user.data.state}, your ${user.data.entityType} needs to file ${reportInfo}.\n\nIt's how the state knows your business is still active. Missing it can mean fines or losing your business status.\n\nHave you made any estimated tax payments to the IRS this year?\n\n1️⃣ Yes\n2️⃣ No\n3️⃣ I didn't know I had to`
      );
    }

    if (input === "2" || input.includes("no")) {
      const reportInfo = getStateReport(user.data.state);
      return reply(res,
        `Got it — I've made a note. Your ${user.data.state} report is due ${reportInfo}. I'll remind you before it's due.\n\nHave you made any estimated tax payments to the IRS this year?\n\n1️⃣ Yes\n2️⃣ No\n3️⃣ I didn't know I had to`
      );
    }

    return reply(res,
      `Great — you're on top of it. ✓\n\nHave you made any estimated tax payments to the IRS this year?\n\n1️⃣ Yes\n2️⃣ No\n3️⃣ I didn't know I had to`
    );
  }

  // STEP 7: Estimated taxes
  if (step === 7) {
    user.data.estimatedTaxes = input;
    user.step = 8;
    await saveUser(user);

    if (input === "3" || input.includes("didn't know")) {
      return reply(res,
        `That's really common — nobody teaches this stuff.\n\nHere's the short version: when you own a business, the IRS expects you to pay taxes 4 times a year instead of once. They're called estimated tax payments.\n\nMissing them can cause penalties. But don't panic — I'll help you get on track.\n\nDo you have an EIN (Employer Identification Number)?\n\n1️⃣ Yes, I have one\n2️⃣ No\n3️⃣ What's that?`
      );
    }

    return reply(res,
      `Good to know. Do you have an EIN (Employer Identification Number) for your business?\n\n1️⃣ Yes, I have one\n2️⃣ No\n3️⃣ What's that?`
    );
  }

  // STEP 8: EIN
  if (step === 8) {
    user.data.hasEIN = input;
    user.step = 9;
    await saveUser(user);

    if (input === "3" || input.includes("what")) {
      return reply(res,
        `An EIN is like a Social Security number for your business — the IRS uses it to identify you.\n\nYou need one to open a business bank account, file taxes, and hire employees. Get one FREE at IRS.gov in about 5 minutes.\n\nWant me to remind you to do that this week?\n\n1️⃣ Yes, remind me\n2️⃣ I'll do it right now\n3️⃣ I actually have one already`
      );
    }

    if (input === "2" || input.includes("no")) {
      return reply(res,
        `You'll want to get that soon — it's free and only takes 5 minutes at IRS.gov.\n\nRoughly how much does ${user.data.businessName || "your business"} bring in per month?\n\n1️⃣ Under $2,000\n2️⃣ $2,000 – $5,000\n3️⃣ $5,000 – $10,000\n4️⃣ $10,000 – $25,000\n5️⃣ Over $25,000\n6️⃣ It varies a lot`
      );
    }

    return reply(res,
      `Perfect. Roughly how much does ${user.data.businessName || "your business"} bring in per month on average?\n\n1️⃣ Under $2,000\n2️⃣ $2,000 – $5,000\n3️⃣ $5,000 – $10,000\n4️⃣ $10,000 – $25,000\n5️⃣ Over $25,000\n6️⃣ It varies a lot`
    );
  }

  // STEP 9: Revenue
  if (step === 9) {
    user.data.revenue = input;
    user.step = 10;
    await saveUser(user);
    const est = getTaxEstimate(input);
    return reply(res,
      `Based on your revenue, you should be setting aside about $${est.low.toLocaleString()}–$${est.high.toLocaleString()}/month for taxes. This is an estimate for planning — not tax advice.\n\nDo you have a separate savings account just for taxes?\n\n1️⃣ Yes — I'm already doing this\n2️⃣ No\n3️⃣ Not yet but I want to`
    );
  }

  // STEP 10: Tax savings
  if (step === 10) {
    user.data.taxSavings = input;
    user.step = 11;
    await saveUser(user);

    if (input === "1" || input.includes("yes")) {
      return reply(res,
        `That's the single best thing you can do. Keep it up. ✓\n\nDo you sell physical products or taxable services?\n\n1️⃣ Yes — I collect sales tax\n2️⃣ Yes — but I haven't set up sales tax yet\n3️⃣ No, I'm a service business\n4️⃣ Not sure`
      );
    }

    return reply(res,
      `That's the first thing I'd suggest this week — open a free savings account and label it "Taxes Only."\n\nEvery time money comes in, move 25% into that account before you spend anything. It doesn't have to be perfect — it just has to exist.\n\nWant a reminder Friday to set that up?\n\n1️⃣ Yes, remind me Friday\n2️⃣ I'll do it now\n3️⃣ I already have something like this`
    );
  }

  // STEP 11: Sales tax → wrap up onboarding
  if (step === 11) {
    user.data.salesTax = input;
    user.step = 12;
    await saveUser(user);

    // Mark onboarding complete in Supabase
    await supabase.from("members")
      .update({ onboarding_complete: true, onboarding_completed_at: new Date().toISOString() })
      .eq("phone", from);

    const est = getTaxEstimate(user.data.revenue);
    const reportInfo = getStateReport(user.data.state);

    return reply(res,
      `You're all set, ${user.data.name || "friend"}. Here's what I have:\n\n🏢 ${user.data.businessName || "Your business"}\n📍 ${user.data.state} · ${user.data.entityType}\n📅 Annual report: ${reportInfo}\n💰 Tax savings goal: $${est.low.toLocaleString()}–$${est.high.toLocaleString()}/month\n\nI'll reach out before anything is due. You won't hear from me unless something needs your attention.\n\nYou've got this. 🤝`
    );
  }

  // STEP 12+: Ongoing conversation
  await supabase.from("members")
    .update({ last_active: new Date().toISOString() })
    .eq("phone", from);

  return reply(res,
    `Got it. Reply HELP to see what I can do, or STATUS to check where everything stands. I'll reach out when something needs your attention. 🤝`
  );
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Health check ─────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "FileFirm / Cadence", time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FileFirm / Cadence running on port ${PORT}`));
