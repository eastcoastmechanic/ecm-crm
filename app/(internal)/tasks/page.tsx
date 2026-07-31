import { supabase } from "@/lib/supabase";
import { addTask } from "./actions";
import TaskList from "./TaskList";
import SubmitButton from "../SubmitButton";
import { buttonClass, cardClass, errorClass, headingClass, inputClass, subTextClass } from "../ui";

export default async function TasksPage() {
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, notes, due_at, customers(name)")
    .is("completed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={headingClass}>Tasks</h1>
        <p className={subTextClass}>To-dos and reminders — yours or created by the CRM assistant.</p>
      </div>

      <form action={addTask} className={cardClass}>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Title
          <input name="title" placeholder="Task title" required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300">
          Due date
          <input name="due_date" type="date" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-g300 sm:col-span-2">
          Notes
          <textarea name="notes" placeholder="Notes" className={inputClass} />
        </label>
        <SubmitButton className={`${buttonClass} sm:col-span-2 sm:w-fit`}>Add Task</SubmitButton>
      </form>

      {error && <p className={errorClass}>Error loading tasks: {error.message}</p>}

      <TaskList tasks={tasks ?? []} />
    </div>
  );
}
