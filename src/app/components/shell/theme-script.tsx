// Runs before paint so a saved light/dark choice never flashes the other theme. "system" leaves
// the attribute off and lets prefers-color-scheme decide (see tokens.css).
const SCRIPT =
  "(function(){try{var t=localStorage.getItem('sortie.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
