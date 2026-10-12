# Figma reference renders

`screens.png` and `styleguide.png` are renders of the Figma file from before the 2026-10-06
redesign (the top bar, the log-in and sign-up screens, the quiz feedback state and the Concept
Atlas came after). `assets/` holds the SVGs traced for the first build.

The 2026-10-06 sync was done through the Figma MCP from a cloud session that could read the file
but not fetch its asset exports (figma.com is blocked by that environment's network policy), so
these are drawn by hand after the renders and should be swapped for real exports:

- `Logo/Orca Waves` (128:547): the two arcs in `src/components/brand/OrcaLogo.tsx` (`waves`).
- `Icon/Settings` (117:61) and `Icon/Log out` (117:66): `IconSettings`, `IconLogOut` in
  `src/components/icons.tsx`.
- The five avatars (`Creature=Orca … Jellyfish`, 151:230–151:278): `src/components/brand/Avatar.tsx`.
- Sea-life decorations on the Concept Atlas (`Sea/Fish A`, `Fish B`, `Jellyfish`, `Bubbles`,
  `Starfish`, `Coral Branch`, `Fan Coral`, `Kelp`, page Concept Atlas → Sea Life Assets) and the
  coral on Onboarding: not drawn.

To export: select the component in Figma → Export → SVG, drop the files in `assets/`, and replace
the hand-drawn paths. New full-page renders of the Screens and Concept Atlas pages would replace
`screens.png`.
