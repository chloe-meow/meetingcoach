export type AgendaItem = {
  title: string;
  plannedMinutes: number;
  order: number;
};

export function parseAgenda(description: string): AgendaItem[] {
  return description
    .split(/\r?\n/)
    .map((line, i) => {
      const m = line
        .trim()
        .match(/^(?:[-*]\s*)?(.+?)(?:\s*[\-–(]\s*(\d+)\s*m\s*[)\-])?$/i);
      if (!m) return null;
      const title = m[1].trim();
      const dur = m[2] ? Number(m[2]) : 10;
      if (!title) return null;
      return { title, plannedMinutes: dur, order: i };
    })
    .filter(Boolean) as AgendaItem[];
}
