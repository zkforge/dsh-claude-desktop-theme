These regression fixtures come from the official Windows DSH 0.2.2-rc.1
archive, build `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`.

The CSS preserves relevant native rules from AppFrame, PluginManagerPage,
DiscoverSection, TaskManagerPage, AccountMenu, Button and Menu. Loading them
before the plugin styles catches cascade, flex sizing and sticky header bugs
that isolated plugin CSS cannot reproduce. The browser test supplies the
palette aliases used by these rules, the actual MainPanel wrapper and small
DOM cases derived from the corresponding component functions. All content is
demonstration data.

`header-scroll.mjs` is the isolated native header-scroll module from
ui-plugin-manager/lib/client.js, with `attach` exported for the test. It executes
the real hidden clone measurements, ResizeObserver, inline translation/width/
clip changes, compact state and Info inert state. The test attaches it before
the plugin observer runs, matching React commit order.

The repository contains neither the archive nor a complete application bundle.
