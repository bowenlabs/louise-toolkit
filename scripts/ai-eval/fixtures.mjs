// Fixed inputs for scripts/ai-eval/run.mjs. Fixed so two runs, before and after
// a model or prompt change, compare the same thing.
//
// Every fixture follows Google's example conventions (CLAUDE.md, Documentation
// style): example.com addresses, names from Google's list, 800-555-01xx phone
// numbers. `keep` lists what a rewrite must not lose: names, numbers, prices,
// dates, URLs, and phone numbers are what an owner notices first when an
// assist quietly changes them.

/** Passages for `rewriteText`, run in every mode. */
export const REWRITE_FIXTURES = [
  {
    text: "We are open from 7 a.m. to 3 p.m. on weekdays, and from 8 a.m. to 2 p.m. on Saturdays and Sundays, so come by whenever it suits you.",
    keep: ["7 a.m.", "3 p.m.", "8 a.m.", "2 p.m."],
  },
  {
    text: "Alex started the shop in 2019 after spending ten years roasting coffee for other people, and it has been growing slowly but steadily ever since then.",
    keep: ["Alex", "2019"],
  },
  {
    text: "To book a private tasting for a group of up to 12 people, call us at 800-555-0142 or send an email to events@example.com at least a week ahead.",
    keep: ["12", "800-555-0142", "events@example.com"],
  },
  {
    text: "Our house blend costs $18 for a 12-ounce bag, and subscribers get free shipping on every order over $35 within the continental United States.",
    keep: ["$18", "12-ounce", "$35"],
  },
  {
    text: "You can read the full returns policy at https://example.com/returns, but in short, unopened items can be returned within 30 days for a full refund.",
    keep: ["https://example.com/returns", "30 days"],
  },
  {
    text: "Kai and Quinn will be leading the latte art workshop on Saturday, March 14, and every participant will take home a milk pitcher and a printed guide.",
    keep: ["Kai", "Quinn", "March 14"],
  },
  {
    text: "The studio is located on the second floor of the building, directly above the bakery, and the entrance is around the back through the courtyard gate.",
    keep: ["second floor"],
  },
  {
    text: "Each print is signed and numbered, produced in an edition of 50 on archival cotton paper, and ships flat in a rigid mailer within 3 business days.",
    keep: ["50", "3 business days"],
  },
  {
    text: "Gift cards are available in amounts of $25, $50, and $100, never expire, and can be used both in the shop and on our website at example.com.",
    keep: ["$25", "$50", "$100", "example.com"],
  },
  {
    text: "Due to the fact that we roast in small batches, it is possible that some of the single-origin coffees may sell out before the end of the month.",
    keep: ["single-origin"],
  },
  {
    text: "Quinn has been teaching ceramics for over 15 years and currently runs the Tuesday and Thursday evening classes, which start at 6:30 p.m.",
    keep: ["Quinn", "15 years", "6:30 p.m."],
  },
  {
    text: "If you have any questions at all about your order, please don't hesitate to reach out to our support team at help@example.com and we will get back to you.",
    keep: ["help@example.com"],
  },
  {
    text: "The seasonal menu changes four times a year, and the autumn menu, which launches on September 22, includes a maple oat latte and a pumpkin loaf.",
    keep: ["September 22"],
  },
  {
    text: "Wholesale accounts need a minimum order of 20 pounds per month, and pricing starts at $11.50 per pound with discounts above 50 pounds.",
    keep: ["20 pounds", "$11.50", "50 pounds"],
  },
  {
    text: "Parking is available on the street after 6 p.m. and all day on Sundays, and there is a public lot two blocks away at 200 Example Street.",
    keep: ["6 p.m.", "200 Example Street"],
  },
  {
    text: "Every commission begins with a 30-minute consultation, after which Alex sends a sketch and a quote within 5 working days, with no obligation.",
    keep: ["30-minute", "Alex", "5 working days"],
  },
  {
    text: "The newsletter goes out on the first Monday of each month and includes new arrivals, upcoming events, and a discount code for 10% off.",
    keep: ["10%"],
  },
  {
    text: "Orders placed before 11 a.m. Central Time ship the same day, while orders placed after that ship on the next business day.",
    keep: ["11 a.m.", "Central Time"],
  },
  {
    text: "Kai roasts every batch by hand on a 5-kilogram drum roaster, checking the color and the aroma every 30 seconds during the final minutes.",
    keep: ["Kai", "5-kilogram", "30 seconds"],
  },
  {
    text: "For accessibility questions, including step-free access and seating, call 800-555-0199 before your visit and we'll make sure everything is ready.",
    keep: ["800-555-0199"],
  },
];

/**
 * Passages with seeded mistakes, for `rewriteText` in `fix` mode. `fixes` maps
 * each mistake to its correction; the check is that the mistake is gone and the
 * rest of the wording barely moved.
 */
export const FIX_FIXTURES = [
  {
    text: "We recieve new beans every tuesday, and they are usualy roasted by thursday.",
    fixes: { recieve: "receive", usualy: "usually" },
    keep: [],
  },
  {
    text: "Alex have been baking bread here since 2015 and its still the best part of the day.",
    fixes: { "Alex have": "Alex has", "and its still": "and it's still" },
    keep: ["Alex", "2015"],
  },
  {
    text: "The class cost $40 per person, all materials is included.",
    fixes: { "materials is": "materials are" },
    keep: ["$40"],
  },
  {
    text: "Please email events@example.com if you would like to reserve the space, we reply within two days.",
    fixes: {},
    keep: ["events@example.com", "two days"],
  },
  {
    text: "Our new store is located accross from the library on Example Avenue.",
    fixes: { accross: "across" },
    keep: ["Example Avenue"],
  },
];

/** Page contents for `suggestSeo`. `topic` must appear in the title or description. */
export const SEO_FIXTURES = [
  {
    content:
      "Small-batch coffee roasted in the neighborhood. We roast single-origin beans twice a week and sell them by the bag, with free local delivery on orders over $30.",
    topic: "coffee",
  },
  {
    content:
      "Ceramics classes for beginners and returning students. Six-week courses on the wheel and in hand building, taught by working potters in a studio with 10 wheels.",
    topic: "ceramics",
  },
  {
    content:
      "Original linocut prints and paintings by a local artist. Each print is signed and numbered, and commissions are open for portraits and house illustrations.",
    topic: "print",
  },
  {
    content:
      "A neighborhood bakery making sourdough, croissants, and seasonal pastries every morning. Order ahead for pickup, or find us at the Saturday market.",
    topic: "bakery",
  },
  {
    content:
      "Wholesale coffee for cafés and offices. Minimum order 20 pounds per month, with training for your staff and equipment servicing included.",
    topic: "wholesale",
  },
  {
    content:
      "Latte art workshops on weekends. Learn to steam milk and pour hearts, tulips, and rosettas in a two-hour hands-on session for up to eight people.",
    topic: "latte",
  },
  {
    content:
      "Gift cards for coffee lovers, in any amount from $10 to $200. They never expire and work in the shop and online.",
    topic: "gift card",
  },
  {
    content:
      "Our returns policy: unopened items can be returned within 30 days for a full refund. Opened coffee can be exchanged if you're unhappy with it.",
    topic: "return",
  },
  {
    content:
      "Visit the studio: we're on the second floor above the bakery, open Wednesday through Sunday from 10 a.m. to 5 p.m. Step-free access through the courtyard.",
    topic: "studio",
  },
  {
    content:
      "Coffee subscriptions delivered every two or four weeks. Choose a roast level, pause or skip anytime, and get 10% off every bag.",
    topic: "subscription",
  },
  {
    content:
      "Custom pet portraits painted from your photos. Watercolor or acrylic, in three sizes, delivered framed within four weeks.",
    topic: "portrait",
  },
  {
    content:
      "Private tastings for groups of up to 12. We guide you through five single-origin coffees and explain how origin and roast change the cup.",
    topic: "tasting",
  },
  {
    content:
      "Hand-thrown mugs, bowls, and vases in small runs. Every piece is food safe, dishwasher safe, and glazed in our own colors.",
    topic: "mug",
  },
  {
    content:
      "Brewing guides for pour-over, French press, and espresso at home, with grind sizes, ratios, and timings for each method.",
    topic: "brew",
  },
  {
    content:
      "Event catering with a mobile espresso bar. We bring the machine, the baristas, and the coffee to weddings, conferences, and parties.",
    topic: "espresso",
  },
  {
    content:
      "About us: a family-run roastery founded in 2019. We buy directly from farms we visit and pay above fair-trade prices.",
    topic: "roast",
  },
  {
    content:
      "Framing services for prints, photographs, and textiles, with archival mats and UV-protective glass. Most orders are ready in a week.",
    topic: "fram",
  },
  {
    content:
      "Open studio nights on the first Friday of every month. Meet the artists, see works in progress, and enjoy free refreshments.",
    topic: "studio",
  },
  {
    content:
      "Decaf coffee that tastes like coffee. Our Swiss Water decaf is chemical-free and roasted to the same profile as our house blend.",
    topic: "decaf",
  },
  {
    content:
      "Contact us by email at hello@example.com or call 800-555-0100. We answer within one business day.",
    topic: "contact",
  },
];
