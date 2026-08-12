-- Separate drive time from time on site.
--
-- tracked_hours was computed from on_way_at, which is stamped when the tech
-- leaves for the job. That measures "how long since I got in the truck",
-- so every job costed with it silently carries the drive in its labour
-- number — and the drive to Fall River is not the drive to Assonet.
--
-- arrived_at is stamped when the tech actually gets on site. Once it's set,
-- tracked_hours is measured from it; jobs that only ever had on_way_at keep
-- their old basis, so historical numbers don't shift under anyone.
--
-- Both columns are kept: on_way_at → arrived_at is drive time, which is worth
-- knowing on its own for routing and for what a service call really costs.

alter table jobs add column if not exists arrived_at timestamptz;

-- Backfill nothing on purpose. A guessed arrival time would look like data
-- and cost a real job-costing decision later; blank is honest.

comment on column jobs.arrived_at is
  'When the tech reached the site. tracked_hours is measured from this when set, else from on_way_at. on_way_at -> arrived_at is drive time.';
