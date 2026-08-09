/**
 * Customer reviews published on ECM's Google Business profile.
 *
 * Kept as curated data rather than pulled from the Google Places API: that
 * needs a billed API key and an ongoing quota for content that changes a few
 * times a year, and Places only returns five reviews with no control over
 * which. These are transcribed verbatim — reviews are quotations, so typos and
 * phrasing are left exactly as the customer wrote them.
 *
 * Names are the reviewer's public Google display name, unchanged. That differs
 * from the satisfaction-survey path in Reviews.tsx, which shortens private
 * survey responses to "First L." — these were already published publicly under
 * these names by their authors.
 *
 * Add new ones at the top; the homepage renders them in array order.
 */

export type CuratedReview = {
  name: string;
  rating: number;
  comment: string;
};

export const GOOGLE_REVIEWS: CuratedReview[] = [
  {
    name: "Kai Srisirikul",
    rating: 5,
    comment:
      "Josh is fantastic. He is very professional, detail oriented and great to deal with. We had a small issue and he came right over and backed up his work. If you're looking for a honest, straightforward and smart professional to help with you HVAC needs, Josh is the guy. I can't recommend him enough.",
  },
  {
    name: "H F",
    rating: 5,
    comment:
      "Could not recommend working with Josh and ECM more. The level of care and pride in his work is hard to come by these days and incredibly appreciated. Can confidently tell people I got a guy when any HVAC questions or concerns arise. Thank you Josh!",
  },
  {
    name: "Jared Wiedemann",
    rating: 5,
    comment:
      "After a nightmare experience with a large corporate HVAC company that left my AC unit improperly reassembled — causing water damage to my home — I was understandably nervous calling someone new. Josh at East Coast Mechanical was exactly what I needed. He picked up right away, got me in quickly during peak season, and diagnosed the problem immediately. What stood out most was how he walked me through everything step by step — what was wrong, why it happened, and exactly what he was going to do to fix it. No upselling, no runaround, just honest straightforward work. If you're tired of the big corporate companies that treat you like a number, call Josh. He's the kind of technician you want taking care of your home. East Coast Mechanical has earned a customer for life.",
  },
  {
    name: "Minda Tavares",
    rating: 5,
    comment:
      "We were having problem keeping our system, duckless aircondition cool. When Josh came, he analyzed the problem and explained the problem to us. His explanation was clear and easy to understand. When he was done, everything was working great! Josh, did a wonderful job! He will be our permanent maintenance from now on!",
  },
  {
    name: "Kristen Maney",
    rating: 5,
    comment:
      "Josh is incredible, and saved us when our heat wasn't working. After having reached out to many companies and them never getting back to me, I got a referral from my Mom after Josh had fixed her furnace. He got right back to me, asked questions before showing up, was there when he said he would be, was very nice and comfortable to have in the house, honest, very knowledgeable and took the time to show and explain the different issues in detail. Not only was he able to fix our heat pump (and make it run better than it ever has), he went out of his way to contact the heat pump manufacturer to see if it was under warranty (it was and he saved me thousands of dollars on the part by doing this and got my warranty extended 5 years!) He also contacted about the initial installer not installing correctly, and got the rest of the bill covered by them. I have never heard or experienced someone doing this before, and wouldn't have thought to do those things myself. Truly, I cannot recommend him enough; he is the only person I will trust with future HVAC issues.",
  },
  {
    name: "Maureen M",
    rating: 5,
    comment:
      "I cannot say enough about Josh. Totally reliable, honest, friendly, extremely knowledgeable and comfortable to have in your home. Explained everything so well to me (a 70 year old woman) and gave best price possible. Got my heat up and running within hours! I have given his info to so many people! My daughter just called him today. He got right back to her, got by same day and figured out her issue. She was so impressed!",
  },
  {
    name: "Aubrey St. Pierre",
    rating: 5,
    comment:
      "Josh is the best! He's friendly with my kids and didn't even mind letting my son watch help but I am so glad I chose his company! He got it working and is professional but personable he explained everything to me so I could understand and i appreciated his promptness when he said he would be here he was here right on time! Thanks josh!",
  },
  {
    name: "Jake Casey",
    rating: 5,
    comment:
      "Timely and Professional. Quality guys to work with! Very neat and clean as well, no mess left behind!",
  },
];
