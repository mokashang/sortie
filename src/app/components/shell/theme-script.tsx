// Runs before paint so a saved light/dark choice never flashes the other theme. "system" leaves
// the attribute off and lets prefers-color-scheme decide (see tokens.css). ?theme=light|dark on
// the URL wins for that load (screenshots, sharing a look without touching the saved choice).
const SCRIPT =
  "(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q||localStorage.getItem('sortie.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
