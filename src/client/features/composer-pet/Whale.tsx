/**
 * Hand-drawn 32 × 24 pixel interpretation of the DeepSeek whale.
 *
 * Brand reference: deepseek-ai/DeepSeek-V2/figures/logo.svg (blue body, pale
 * belly, light eye, swept pectoral fin and raised split tail). The mark is
 * drawn at 1:1 with the grid and rendered at 32 × 24 CSS px, so one artwork
 * pixel is one CSS pixel (two device pixels on a Retina display) and
 * `crispEdges` keeps every step on a whole device pixel. The eye sits near the
 * tail, as in the mark; the head is the blunt left end.
 *
 * ComposerPet owns the local click reactions. The spray is offset three grid
 * pixels towards the middle of the head, matching the approved preview.
 *
 * The parts are classes, not fixed fills: `pet.css` paints the body from
 * `--ccd-pet-blue` and the belly／eye from `--ccd-pet-light`, so the mark
 * follows the palette in both schemes.
 */
export function Whale() {
  return (
    <svg className="ccd-pet-art" viewBox="0 0 32 24" width="32" height="24" aria-hidden="true" shapeRendering="crispEdges">
      <g className="ccd-pet-body">
        <path className="ccd-pet-tail" d="M23 12V8H22V5H23V2H24V4H26V5H27V7H28V6H30V5H32V8H31V10H29V11H27V14H25V16H22Z" />
        <path d="M1 11V9H2V7H4V5H7V4H12V5H15V4H18V5H17V7H19V9H21V11H24V15H23V18H21V20H19V22H16V23H10V22H7V21H5V19H3V17H2V14H1Z" />
        <path className="ccd-pet-belly" d="M3 11H6V12H9V13H11V15H13V17H15V19H18V21H15V20H12V18H10V19H11V20H9V19H7V18H6V17H5V15H4V13H3Z" />
        <path className="ccd-pet-fin" d="M17 17H19V18H21V19H24V20H26V21H23V22H20V21H18V20H17Z" />
        <path className="ccd-pet-eye" d="M17 11H19V12H20V14H18V13H17Z" />
        <path className="ccd-pet-eye-shut" d="M17 12H20V13H17Z" />
        <g className="ccd-pet-spout-position" transform="translate(3 0)">
          <g className="ccd-pet-spout ccd-pet-spout-stem"><path d="M9 4V-3H10V-4H11V4Z M7 -4H9V-2H7Z M11 -4H13V-2H11Z" /></g>
          <g className="ccd-pet-spout ccd-pet-spout-left"><path d="M6 -5H8V-3H6Z" /></g>
          <g className="ccd-pet-spout ccd-pet-spout-right"><path d="M12 -5H14V-3H12Z" /></g>
          <g className="ccd-pet-spout ccd-pet-spout-top"><path d="M9 -7H11V-5H9Z" /></g>
        </g>
      </g>
    </svg>
  );
}
