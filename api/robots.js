module.exports = (req, res) => {
  const host = 'www.manilapampangagotaxi.com';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /pay\nDisallow: /rebook\nDisallow: /track\n\nSitemap: https://' + host + '/sitemap.xml\n');
};
