// BMW X-series catalog terms for whole differential assemblies, not their components.
const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/х(?=[1-7])/g, 'x').replace(/\s+/g, ' ').trim();
const AXLES = {
  front: { label: 'Редуктор переднего моста', query: 'привод переднего моста', group: '31', groupName: 'Передний мост' },
  rear: { label: 'Редуктор заднего моста', query: 'редуктор главной передачи', group: '33', groupName: 'Задний мост' },
};
function axleFor(value, allowShort = false) {
  const text = normalize(value).replace(/[.!?]+$/, '');
  if (text === AXLES.front.query || /^(передний редуктор(?: моста)?|редуктор переднего моста|редуктор передний)$/.test(text) || (allowShort && text === 'передний')) return 'front';
  if (text === AXLES.rear.query || /^(задний редуктор(?: моста)?|редуктор заднего моста|редуктор задний)$/.test(text) || (allowShort && text === 'задний')) return 'rear';
  if (text === 'редуктор' || text === 'редуктор моста') return 'ask';
  return null;
}
function routeFor(vehicle, keyword) {
  if (String(vehicle.brand || '').toUpperCase() !== 'BMW') return null;
  if (![vehicle.name, vehicle.modelCode, vehicle.options?.['Код модели']].some(v => /(?:^|[^a-z0-9а-я])x[1-7](?![a-z0-9а-я])/.test(normalize(v)))) return null;
  return axleFor(keyword);
}
module.exports = { AXLES, axleFor, routeFor, normalize };
