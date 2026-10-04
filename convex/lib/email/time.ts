/**
 * Dates in emails, in Georgia's time zone (UTC+4 all year, no daylight saving),
 * written out without relying on the runtime's locale data.
 */

const TBILISI_OFFSET_MS = 4 * 60 * 60 * 1000;

const MONTHS = {
  ka: ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const DAYS = {
  ka: ["კვი", "ორშ", "სამ", "ოთხ", "ხუთ", "პარ", "შაბ"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

/** "ორშ, 6 ოქტ, 18:00" / "Mon, 6 Oct, 18:00". */
export function formatTbilisi(ms: number, locale: "ka" | "en"): string {
  const d = new Date(ms + TBILISI_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${DAYS[locale][d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[locale][d.getUTCMonth()]}, ${hh}:${mm}`;
}
