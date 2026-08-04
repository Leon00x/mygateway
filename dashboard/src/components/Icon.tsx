export type IconName = 'home' | 'channels' | 'models' | 'keys' | 'system' | 'docs' | 'logout' | 'search' | 'menu' | 'close' | 'moon' | 'sun' | 'panel-collapse' | 'panel-expand';

export default function Icon(props: { name: IconName; size?: number; class?: string }) {
  const size = () => props.size ?? 18;
  const paths: Record<IconName, JSX.Element> = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/></>,
    channels: <><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m8 7.5 2.8 7.7M16 7.5l-2.8 7.7M8.5 6h7"/></>,
    models: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
    keys: <><circle cx="8" cy="15" r="5"/><path d="m11.5 11.5 8-8M16 7l3 3M14 9l3 3"/></>,
    system: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.71.66.98.3.27.68.42 1.08.42H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></>,
    docs: <><path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 13h8M8 17h6"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    moon: <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/></>,
    'panel-collapse': <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M16 9l-3 3 3 3"/></>,
    'panel-expand': <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9l3 3-3 3"/></>,
  };
  return (
    <svg class={props.class} width={size()} height={size()} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {paths[props.name]}
    </svg>
  );
}
