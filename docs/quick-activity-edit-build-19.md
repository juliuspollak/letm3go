# Quick activity correction — build 19

Activity details now show a pencil beside the activity type. Its accessible native
select saves a changed type immediately, without opening the complete editor.
Custom titles, description, notes, tags, collection and vehicle are retained.
Persistence failures are shown next to the selector; successful native saves
refresh the displayed activity and retain the existing user-correction priority.

Generated automatic titles no longer include “Automatically detected” in the
activity list or detail heading. Existing stored generated titles are simplified
for display, without rewriting history. New automatic records use a short title;
custom titles and saved-place route names remain intact. Full Edit remains for
other fields. Build 19 also includes build 18's low-power idle monitoring fix.

ESLint, 134 automated tests, 71 native assertions, production build, Capacitor
sync, signed iPhone build and strict signature verification passed. Installation
was retried with both the paired identifier and hardware UDID but failed because
CoreDevice lists the phone unavailable (error 1011). Build 19 is not installed or
launched. Last confirmed successful device installation remains build 17.

User clarified that the shopping records represent outward and return trips,
not overlapping duplicate activities. Classification was the reported issue.

Installation follow-up: after reconnection, build 19's version and strict code
signature were verified, then CoreDevice successfully installed and launched it
on the paired iPhone. This supersedes the failed-install status above. Actual
idle indicator behaviour, battery use and departure reliability remain subject
to physical testing; quick activity selection also awaits user acceptance.
