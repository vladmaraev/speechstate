// docmd.config.js
export default defineConfig({
  // --- Core Metadata ---
  title: 'SpeechState',
  url: '', // e.g. https://mysite.com (Critical for SEO/Sitemap)

  // --- Branding ---
  // logo: {
  //   light: 'assets/images/docmd-logo-dark.png',
  //   dark: 'assets/images/docmd-logo-light.png',
  //   alt: 'Logo',
  //   href: '/',
  // },
  // favicon: 'assets/favicon.ico',

  // --- Source & Output ---
  src: 'docs',
  out: 'site',

  // --- Layout & UI Architecture ---
  layout: {
    breadcrumbs: false,
    spa: true, // Enable seamless page transitions
    header: {
      enabled: true,
    },
    sidebar: {
      collapsible: true,
      defaultCollapsed: false,
    },
    optionsMenu: {
      position: 'sidebar-top', // 'menubar', 'header', 'sidebar-top', 'sidebar-bottom'
      components: {
        search: true,      
        themeSwitch: true, 
        sponsor: null,     
      }
    },
    footer: {
      style: 'minimal', // 'minimal' or 'complete'
      content: '2001 – ' + new Date().getFullYear() + ' SpeechState',
      branding: false    // Config for "Built with docmd" badge
    }
  },

  // --- Theme Settings ---
  theme: {
    name: 'ruby',        // Options: 'default', 'sky', 'ruby', 'retro'
    appearance: 'system',   // 'light', 'dark', or 'system'
    codeHighlight: true,    
    customCss: [],          
  },

  // --- General Features ---
  minify: true,           
  autoTitleFromH1: true,  
  copyCode: true,         
  pageNavigation: false,   
  
  customJs: [],           

  // --- Versioning (Optional) ---
  /*
  versions: {
    position: 'sidebar-top', // 'sidebar-top', 'sidebar-bottom'
    current: 'v2',
    all: [
      { id: 'v2',       // Unique identifier for this version (used in URLs) and matching current version
       dir: 'docs',     // Source directory for latest version
       label: 'v2.0 (Latest)'
      },
      { id: 'v1',
       dir: 'docs-v1',  // Source directory for older version
       label: 'v1.0'
      }
    ]
  },
  */

  // --- Navigation (Sidebar) ---
  navigation: [
    { title: 'Overview', path: '/', icon: 'home' },
    {
      title: 'Getting Started',
      icon: 'rocket',
      collapsible: false,
      children: [
        { title: 'Installation', path: '', icon: 'download', path: 'installation' },
      ],
    },
    {
      title: 'Core features',
      icon: 'sparkles',
      collapsible: false,
      children: [
        { title: 'Speech Synthesis', path: '', icon: 'audio-waveform', path: 'tts' },
        { title: 'Speech Recognition', path: '', icon: 'mic-vocal', path: 'asr' },
      ],
    },
    {
      title: 'Events guide',
      path: 'event'
    },
    { title: 'GitHub', path: 'https://github.com/vladmaraev/speechstate', icon: 'github', external: true },
  ],

  // --- Plugins ---
  plugins: {
    seo: {
      defaultDescription: 'SpeechState: Free browser-based spoken dialogue system',
      openGraph: { defaultImage: '' },
      twitter: { cardType: 'summary_large_image' }
    },
    sitemap: { defaultChangefreq: 'weekly' },
    search: {},
    mermaid: {},
    llms: {}
  },
  
  // --- Edit Link ---
  editLink: {
    enabled: true,
    baseUrl: 'https://github.com/vladmaraev/speechstate/edit/docs/docs',
    text: 'Edit this page'
  }
});
