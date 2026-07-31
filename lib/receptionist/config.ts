// Business hours the AI receptionist quotes to callers/texters when
// checking or offering availability. Mon-Fri, 8am-5pm. Adjust here as needed.
export const BUSINESS_HOURS = {
  daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri (0 = Sunday)
  startHour: 8,
  endHour: 17,
};

// Matches the 2-hour job window used in sendScheduleNotifications
// (app/(internal)/jobs/actions.ts) so availability checks stay consistent
// with how confirmed jobs already block time on the calendar.
export const DEFAULT_JOB_DURATION_HOURS = 2;

export const COMPANY_NAME = "East Coast Mechanical";
