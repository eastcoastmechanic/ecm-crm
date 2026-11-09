-- Lead cards on the Planner "Jobs" plan. Run in the Supabase SQL editor.
--
-- A new lead (Add lead on /leads, or the assistant's add_lead) gets one Planner card in
-- the Tasks bucket. The card's id is saved here so the same lead never gets a second card,
-- and so moving the lead to Won, Lost or Dismissed can add a line and close its card.
--
-- Additive and safe to run more than once. Before it runs the card is still made,
-- just not linked (stage changes then don't reach the card).

alter table leads
  add column if not exists planner_task_id text;

-- One lead per card.
create unique index if not exists leads_planner_task_id_idx on leads (planner_task_id)
  where planner_task_id is not null;
