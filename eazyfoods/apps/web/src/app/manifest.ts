import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return { name: 'EAZyfoods', short_name: 'EAZyfoods', description: 'African and multicultural food, delivered.', start_url: '/', display: 'standalone', background_color: '#faf6ee', theme_color: '#b43f17', icons: [{ src: '/img/brand/logo-default.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] };
}
