import { isUsableTimeZone } from "../modules/polls/index";
import { formatMeetingSlotLocal, meetingSlotDayKey } from "../lib/datetime";


for (const grid of document.querySelectorAll<HTMLElement>("[data-availability-grid]")) {
  const select = grid.querySelector("[data-timezone-select]") as unknown as HTMLSelectElement | null;
  const label = grid.querySelector("[data-timezone-label]") as HTMLElement | null;
  if (!select || !label) continue;
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (isUsableTimeZone(deviceZone) && !Array.from(select.options).some((option) => option.value === deviceZone)) select.add(new Option(deviceZone, deviceZone));
  const render = (candidate: string) => {
    const zone = isUsableTimeZone(candidate) ? candidate : "UTC";
    select.value = zone;
    label.textContent = `TIMES SHOWN IN ${zone} · FROM YOUR DEVICE`;
    for (const row of grid.querySelectorAll<HTMLElement>("[data-slot]")) {
      const starts = Number(row.dataset.startsAt); const ends = Number(row.dataset.endsAt);
      const sourceZone = isUsableTimeZone(row.dataset.sourceZone ?? "") ? row.dataset.sourceZone! : "UTC";
      const output = row.querySelector<HTMLElement>("[data-local-time]");
      const shift = row.querySelector<HTMLElement>("[data-day-shift]");
      if (output) output.textContent = formatMeetingSlotLocal(starts, ends, zone);
      if (shift) {
        const voterDay = meetingSlotDayKey(starts, zone);
        const sourceDay = meetingSlotDayKey(starts, sourceZone);
        const diff = voterDay.localeCompare(sourceDay);
        shift.hidden = diff === 0;
        if (diff !== 0) shift.textContent = diff > 0 ? "+1 day" : "-1 day";
      }
    }
  };
  render(deviceZone);
  select.addEventListener("change", () => render(select.value));
}
