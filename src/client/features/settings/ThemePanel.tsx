import type { ReactElement } from 'react';
import { THEME_PANEL_GLYPH_ATTRIBUTE } from '../../compat/sidebar-navigation.ts';
import { ConfigPage } from './ConfigPage.tsx';
import type { ConfigPageProps } from './ConfigPage.tsx';
import { zh } from './locales.ts';

/**
 * The Theme row's glyph: the palette `navigation-icons.ts` draws, at the size
 * the column asks for. While the interface is on, `sidebar-navigation.ts`
 * recognises the row by the marker and lays its own copy over this one, like
 * the host's rows; while it is off, this is what the native row shows.
 * @param props - the column's glyph size; `icon` is bundled, trusted markup.
 */
export function ThemePanelGlyph({ size = 16, icon }: { readonly size?: number | undefined; readonly icon: string }): ReactElement {
  return (
    <span
      className="ccd-theme-panel-glyph"
      style={{ width: size, height: size }}
      {...{ [THEME_PANEL_GLYPH_ATTRIBUTE]: '' }}
      dangerouslySetInnerHTML={{ __html: icon }}
    />
  );
}

/**
 * The Theme panel: this plugin's configuration as a page of the centre column,
 * opened from its sidebar row. It is the same form the settings dialog's
 * section draws, under the heading the Customize and Scheduled tasks pages
 * carry.
 * @param props - the form, the theme preference and the panel's locale seat.
 */
export function ThemePanelPage(props: ConfigPageProps): ReactElement {
  const title = props.t?.('panel') ?? zh.panel;
  return (
    <div className="ccd-theme-panel">
      <div className="ccd-theme-panel-content">
        <h1 className="ccd-theme-panel-title">{title}</h1>
        <ConfigPage {...props} view="page" />
      </div>
    </div>
  );
}
