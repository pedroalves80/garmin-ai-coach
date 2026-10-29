import { calendarDate, shiftDay } from "../garmin/sync";

export { calendarDate, shiftDay };
export function mondayOf(day: string) {
  return shiftDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
}
