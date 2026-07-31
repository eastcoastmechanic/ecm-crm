export const metadata = {
  title: "Tips & Guides | East Coast Mechanical",
  description: "Practical heating and cooling guidance from East Coast Mechanical.",
};

const ARTICLES = [
  {
    title: "5 Signs Your Furnace Needs a Tune-Up",
    body: "Short cycling, rising energy bills, uneven heat between rooms, strange odors on startup, and a system over 10 years old are all signs worth having a technician look at before a small issue becomes a no-heat emergency. A yearly tune-up catches worn parts and airflow problems while they're still cheap to fix.",
  },
  {
    title: "Ductless Mini-Split vs. Central Air: What's Right for Your Home?",
    body: "Central air is usually the better fit when ductwork already exists and you want whole-home cooling from one system. Ductless mini-splits make more sense for additions, converted spaces, or homes without existing ductwork, since each indoor unit can be controlled independently — good for zoned comfort without a full duct installation.",
  },
  {
    title: "Why Uneven Temperatures Between Rooms Usually Isn't the Thermostat",
    body: "A single thermostat reading one temperature doesn't mean every room feels the same — leaky or undersized ductwork, closed vents, and a system that's not sized correctly for the house are the more common culprits. A duct inspection is usually a better first step than adjusting the thermostat.",
  },
  {
    title: "What a Heat Pump Actually Does (and Doesn't)",
    body: "A heat pump moves heat rather than generating it, which is what makes it efficient for both heating and cooling from the same equipment. In very cold climates, some systems pair a heat pump with a backup heat source for the coldest days — worth discussing with a technician before assuming one system replaces everything.",
  },
];

export default function TipsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl font-extrabold tracking-wide sm:text-4xl">Tips &amp; Guides</h1>
      <p className="mt-3 text-sm text-g300">
        Practical, general guidance on keeping your home comfortable. For anything specific to your
        system, a technician visit beats guesswork.
      </p>

      <div className="mt-10 flex flex-col gap-6">
        {ARTICLES.map((article) => (
          <article key={article.title} className="rounded-xl border border-white/8 bg-white/3 p-6">
            <h2 className="font-display text-lg font-bold">{article.title}</h2>
            <p className="mt-2 text-sm text-g300">{article.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
