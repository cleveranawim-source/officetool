declare module '@timetable' {
  import type { Timetable } from './engine/types';
  const tt: Timetable;
  export default tt;
}

declare module '@events' {
  import type { CalEvent } from './engine/types';
  export const defaultEvents: CalEvent[];
  export const defaultEventsLabel: string;
  export const eventsAreSample: boolean;
}
