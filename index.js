const express = require("express");
const twilio = require("twilio");
const app = express();
app.use(express.urlencoded({ extended: false }));

// ── In-memory user store (replace with Supabase later) ───────────────────
const users = {};

function getUser(phone) {
  if (!users[phone]) {
    users[phone] = { phone, step: 0, data: {} };
  }
  return users[phone];
}

// ── SMS reply helper ──────────────────────────────────────────────────────
function reply(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message);
  res.type("text/xml").send(twiml.toString());
}

// ── Tax savings estimate ──────────────────────────────────────────────────
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

// ── State annual report dates ─────────────────────────────────────────────
const stateReports = {
  "texas":        "May 15 (Franchise Tax Report — TX Comptroller)",
  "california":   "by your anniversary date (Statement of Information — $25 fee)",
  "florida":      "May 1 (Annual Report — $138.75 fee)",
  "new york":     "by your anniversary month (Biennial Statement — $9 fee)",
  "illinois":     "before your anniversary date (Annual Report — $75 fee)",
  "georgia":      "April 1 (Annual Registration — $50 fee)",
  "north carolina":"April 15 (Annual Report — $200 fee)",
  "virginia":     "by your anniversary date (Annual Registration — $50 fee)",
  "washington":   "by your anniversary date (Annual Report — $71 fee)",
  "colorado":     "by your anniversary date (Periodic Report — $10 fee)",
  "arizona":      "not required for LLCs",
  "nevada":       "by your anniversary month (Annual List — $350 fee)",
  "ohio":         "by your anniversary date (Biennial Report — $99 fee)",
  "michigan":     "February 15 (Annual Statement — $25 fee)",
  "pennsylvania": "every 10 years (Decennial Report — $70 fee)",
};

function getStateReport(state) {
  const key = state.toLowerCase().trim();
  return stateReports[key] || "annually — I'll look up your exact date and send it to you";
}

// ── Main SMS webhook ──────────────────────────────────────────────────────
app.post("/sms", (req, res) => {
  const from = req.body.From;
  const body = (req.body.Body || "").trim();
  const input = body.toLowerCase();
  const user = getUser(from);
  const step = user.step;

  // ── STEP 0: First contact ──────────────────────────────────────────────
  if (step === 0) {
    user.step = 1;
    return reply(res,
      `Hey, I'm Cadence. 👋\n\nI'm your business compliance assistant — I'll keep track of your taxes, filings, and deadlines so you don't have to stress about them.\n\nI'll only text you when something actually needs your attention. No spam, ever.\n\nLet's get you set up — takes about 3 minutes.\n\nWhat's your first name?`
    );
  }

  // ── STEP 1: Got name ───────────────────────────────────────────────────
  if (step === 1) {
    user.data.name = body;
    user.step = 2;
    return reply(res,
      `Nice to meet you, ${user.data.name}! What's the name of your business?`
    );
  }

  // ── STEP 2: Got business name ──────────────────────────────────────────
  if (step === 2) {
    user.data.businessName = body;
    user.step = 3;
    return reply(res,
      `Got it. What state is ${user.data.businessName} registered in?`
    );
  }

  // ── STEP 3: Got state ──────────────────────────────────────────────────
  if (step === 3) {
    user.data.state = body;
    user.step = 4;
    return reply(res,
      `What type of business is it? Reply with a number:\n\n1️⃣ LLC\n2️⃣ Sole Proprietor\n3️⃣ S-Corp\n4️⃣ C-Corp\n5️⃣ Partnership\n6️⃣ Not registered yet\n7️⃣ Not sure`
    );
  }

  // ── STEP 4: Got entity type ────────────────────────────────────────────
  if (step === 4) {
    const types = { "1":"LLC","2":"Sole Proprietor","3":"S-Corp","4":"C-Corp","5":"Partnership","6":"Not registered yet","7":"Not sure" };
    user.data.entityType = types[input] || body;
    user.step = 5;
    return reply(res,
      `When did you register ${user.data.businessName}? Approximate month and year is fine.\n\n(Example: March 2021)\n\nIf you haven't registered yet, just reply NOT YET.`
    );
  }

  // ── STEP 5: Got registration date ─────────────────────────────────────
  if (step === 5) {
    user.data.registrationDate = body;
    user.step = 6;
    return reply(res,
      `Have you filed your ${user.data.state} annual report this year?\n\n1️⃣ Yes, I filed it\n2️⃣ No, not yet\n3️⃣ I don't know what that is`
    );
  }

  // ── STEP 6: Annual report check ───────────────────────────────────────
  if (step === 6) {
    user.data.annualReport = input;
    user.step = 7;

    if (input === "3" || input.includes("don't know") || input.includes("not sure")) {
      const reportInfo = getStateReport(user.data.state);
      return reply(res,
        `No worries — most people don't know about this.\n\nIn ${user.data.state}, your ${user.data.entityType} needs to file ${reportInfo}.\n\nIt's how the state knows your business is still active. Missing it can mean fines or losing your business status.\n\nHave you filed anything with your state this year?\n\n1️⃣ Yes\n2️⃣ No\n3️⃣ Not sure`
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

  // ── STEP 7: Estimated taxes ────────────────────────────────────────────
  if (step === 7) {
    user.data.estimatedTaxes = input;
    user.step = 8;

    if (input === "3" || input.includes("didn't know")) {
      return reply(res,
        `That's really common — nobody teaches this stuff.\n\nHere's the short version: when you own a business, the IRS expects you to pay taxes 4 times a year instead of once. They're called estimated tax payments.\n\nMissing them can cause penalties. But don't panic — I'll help you get on track from here.\n\nDo you have an EIN (Employer Identification Number) for your business?\n\n1️⃣ Yes, I have one\n2️⃣ No\n3️⃣ What's that?`
      );
    }

    return reply(res,
      `Good to know. Do you have an EIN (Employer Identification Number) for your business?\n\n1️⃣ Yes, I have one\n2️⃣ No\n3️⃣ What's that?`
    );
  }

  // ── STEP 8: EIN ───────────────────────────────────────────────────────
  if (step === 8) {
    user.data.hasEIN = input;
    user.step = 9;

    if (input === "3" || input.includes("what")) {
      return reply(res,
        `An EIN is like a Social Security number for your business — the IRS uses it to identify you.\n\nYou need one to open a business bank account, file taxes, and hire employees. You can get one FREE at IRS.gov in about 5 minutes.\n\nWant me to remind you to do that this week?\n\n1️⃣ Yes, remind me Friday\n2️⃣ I'll do it right now\n3️⃣ I actually have one already`
      );
    }

    if (input === "2" || input.includes("no")) {
      return reply(res,
        `You'll want to get that soon — it's free and only takes 5 minutes at IRS.gov.\n\nWant me to remind you this week?\n\n1️⃣ Yes, remind me\n2️⃣ I'll do it now`
      );
    }

    return reply(res,
      `Perfect. Roughly how much does ${user.data.businessName} bring in per month on average?\n\n1️⃣ Under $2,000\n2️⃣ $2,000 – $5,000\n3️⃣ $5,000 – $10,000\n4️⃣ $10,000 – $25,000\n5️⃣ Over $25,000\n6️⃣ It varies a lot`
    );
  }

  // ── STEP 9: Revenue ───────────────────────────────────────────────────
  if (step === 9) {
    user.data.revenue = input;
    user.step = 10;
    const est = getTaxEstimate(input);
    return reply(res,
      `Based on your revenue, you should be setting aside about $${est.low.toLocaleString()}–$${est.high.toLocaleString()}/month for taxes.\n\nDo you have a separate savings account just for taxes?\n\n1️⃣ Yes — I'm already doing this\n2️⃣ No\n3️⃣ Not yet but I want to`
    );
  }

  // ── STEP 10: Tax savings account ─────────────────────────────────────
  if (step === 10) {
    user.data.taxSavings = input;
    user.step = 11;
    const est = getTaxEstimate(user.data.revenue);

    if (input === "1" || input.includes("yes")) {
      return reply(res,
        `That's the single best thing you can do. Keep it up. ✓\n\nDo you sell physical products or taxable services?\n\n1️⃣ Yes — I collect sales tax\n2️⃣ Yes — but I haven't set up sales tax yet\n3️⃣ No, I'm a service business\n4️⃣ Not sure`
      );
    }

    return reply(res,
      `That's the first thing I'd suggest this week — open a free savings account and label it "Taxes Only."\n\nEvery time money comes in, move ${Math.round((est.low / ((est.low / 0.25))) * 100)}% into that account before you spend anything. It doesn't have to be perfect — it just has to exist.\n\nWant a reminder Friday to set that up?\n\n1️⃣ Yes, remind me Friday\n2️⃣ I'll do it now\n3️⃣ I already have something like this`
    );
  }

  // ── STEP 11: Sales tax ────────────────────────────────────────────────
  if (step === 11) {
    user.data.salesTax = input;
    user.step = 12;
    return reply(res,
      `Almost done — one last thing.\n\nI want to set up your secure info vault. This is where you'll store your EIN, state login, IRS login, and other important business numbers — so you never have to dig for them again.\n\nI'll send you a link to set that up. It's encrypted and only you can access it.\n\nReady?\n\n1️⃣ Yes, send the link\n2️⃣ I'll set it up later`
    );
  }

  // ── STEP 12: Vault + wrap up ──────────────────────────────────────────
  if (step === 12) {
    user.step = 13;
    const est = getTaxEstimate(user.data.revenue);
    const reportInfo = getStateReport(user.data.state);

    return reply(res,
      `You're all set, ${user.data.name}. Here's what I have:\n\n🏢 ${user.data.businessName}\n📍 ${user.data.state} · ${user.data.entityType}\n📅 Annual report due: ${reportInfo}\n💰 Tax savings goal: $${est.low.toLocaleString()}–$${est.high.toLocaleString()}/month\n\nI'll reach out before anything is due. You won't hear from me unless something needs your attention.\n\nYou've got this. 🤝\n\nVault setup: filecadence.com/vault`
    );
  }

  // ── STEP 13+: Ongoing conversation ───────────────────────────────────
  if (input === "done" || input === "yes" || input === "filed") {
    return reply(res,
      `✓ Marked as done. You won't hear about this again until next time it's due. Nice work, ${user.data.name || "friend"}.`
    );
  }

  if (input === "help") {
    return reply(res,
      `I'm here. What do you need help with?\n\nReply:\nTAXES — help with estimated taxes\nFILING — help with a state filing\nMAIL — you got something confusing in the mail\nSTATUS — see where you stand on everything`
    );
  }

  if (input === "status") {
    return reply(res,
      `Here's where ${user.data.businessName || "your business"} stands:\n\n📋 State: ${user.data.state || "not set"}\n🏢 Entity: ${user.data.entityType || "not set"}\n📅 Annual report: on my radar\n💰 Tax savings: tracking\n\nNothing urgent right now. I'll text you when something comes up. 🤝`
    );
  }

  // Default fallback
  return reply(res,
    `Got it. Reply HELP if you need anything, or STATUS to see where everything stands. I'll reach out when something needs your attention. 🤝`
  );
});

app.get("/", (req, res) => res.send("Cadence SMS bot is running ✓"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Cadence running on port ${PORT}`));
