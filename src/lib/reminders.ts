/**
 * The optional daily nudge. Notifications are the one feature that can annoy
 * people, so this asks for permission only at the moment it is switched on,
 * and says plainly when permission was refused.
 */
const REMINDER_ID = 4201;

/** The next time today's or tomorrow's clock next reads `hour:00`. */
function nextOccurrence(hour: number): Date {
  const when = new Date();
  when.setHours(hour, 0, 0, 0);
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
  return when;
}

/** Schedule a repeating daily reminder. Returns false if not permitted. */
export async function scheduleReminder(hour: number): Promise<boolean> {
  try {
    const { Schedule, cancel, isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");

    let permitted = await isPermissionGranted();
    if (!permitted) {
      permitted = (await requestPermission()) === "granted";
    }
    if (!permitted) return false;

    // Replace any earlier reminder rather than stacking them up.
    await cancel([REMINDER_ID]).catch(() => {});
    await sendNotification({
      id: REMINDER_ID,
      title: "Time for a quick review",
      body: "A couple of minutes now keeps the cards from slipping away.",
      schedule: Schedule.at(nextOccurrence(hour), true, true),
    });
    return true;
  } catch {
    // Desktop builds without a notification service, or a browser preview.
    return false;
  }
}

export async function cancelReminder(): Promise<void> {
  try {
    const { cancel } = await import("@tauri-apps/plugin-notification");
    await cancel([REMINDER_ID]);
  } catch {
    // Nothing scheduled, nothing to cancel.
  }
}
