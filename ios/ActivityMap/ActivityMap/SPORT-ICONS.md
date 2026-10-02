Sport icons are Font Awesome Free 6 artwork by Fonticons, Inc., distributed under CC BY 4.0:
https://fontawesome.com/ — https://creativecommons.org/licenses/by/4.0/

The five SVGs come from the same react-icons/fa6 exports used by the web category catalogue:
FaPersonSkiingNordic, FaPersonWalking, FaPersonRunning, FaPersonBiking, FaPersonCircleQuestion.
Paths are unchanged; SVG dimensions and template color are normalized for Xcode.

Regenerate the icon and color assets with `pnpm exec tsx scripts/sync-ios-sport-assets.ts`.
The source of truth is `src/settings/category.tsx`. Generated assets are checked in;
normal iOS builds require no Node.js process, dependency, or network access.
