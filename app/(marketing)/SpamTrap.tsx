/**
 * A field people never see or tab to. Spam bots fill in every box, so the
 * server treats a filled-in value as a bot and quietly drops the form.
 */
export function SpamTrap() {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Leave this empty
        <input type="text" name="company_website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}
