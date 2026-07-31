"use client";

import { useState } from "react";
import { completeTask } from "./actions";
import { errorClass, itemSubClass, itemTitleClass, subTextClass } from "../ui";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  customers: { name: string }[] | null;
};

function formatDue(dueAt: string | null) {
  if (!dueAt) return null;
  const date = new Date(dueAt);
  const isOverdue = date.getTime() < Date.now();
  const label = date.toLocaleDateString();
  return { label, isOverdue };
}

export default function TaskList({ tasks }: { tasks: Task[] }) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleComplete(task: Task) {
    setErrors((prev) => ({ ...prev, [task.id]: "" }));
    setCompletingId(task.id);
    try {
      const result = await completeTask(task.id);
      if (result.error) {
        setErrors((prev) => ({ ...prev, [task.id]: result.error! }));
      }
    } finally {
      setCompletingId(null);
    }
  }

  if (tasks.length === 0) {
    return <p className={subTextClass}>No open tasks. Nice work.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-white/8">
      {tasks.map((task) => {
        const due = formatDue(task.due_at);
        const customerName = task.customers?.[0]?.name;
        return (
          <div key={task.id} className="flex items-start gap-3 py-3">
            <button
              type="button"
              onClick={() => handleComplete(task)}
              disabled={completingId === task.id}
              title="Mark complete"
              className="mt-0.5 h-5 w-5 flex-shrink-0 rounded border border-white/20 transition-colors hover:border-accent disabled:opacity-40"
            />
            <div className="min-w-0 flex-1">
              <div className={itemTitleClass}>{task.title}</div>
              <div className={itemSubClass}>
                {due && (
                  <span className={due.isOverdue ? "text-accent" : ""}>
                    {due.isOverdue ? "Overdue " : "Due "}
                    {due.label}
                  </span>
                )}
                {due && customerName ? " · " : ""}
                {customerName}
              </div>
              {task.notes && <p className={`mt-1 ${itemSubClass}`}>{task.notes}</p>}
              {errors[task.id] && <p className={`mt-1 ${errorClass}`}>{errors[task.id]}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
