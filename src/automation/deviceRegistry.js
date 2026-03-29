export const LOCATION_LABELS = {
  living_room: 'Living Room',
  bedroom: 'Bedroom',
};

export const DEVICE_LABELS = {
  fan: 'Fan',
  lights: 'Lights',
  ac: 'AC',
};

export const DEVICE_TRANSPORT_NAMES = {
  mock: 'Mock Devices',
  http: 'ESP32 HTTP',
  websocket: 'ESP32 WebSocket',
};

export const DEVICE_REGISTRY = [
  {
    id: 'living_room_fan',
    device: 'fan',
    location: 'living_room',
    label: 'Living Room Fan',
    aliases: ['fan', 'living room fan', 'lounge fan'],
    transports: ['mock', 'http', 'websocket'],
  },
  {
    id: 'living_room_lights',
    device: 'lights',
    location: 'living_room',
    label: 'Living Room Lights',
    aliases: ['living room light', 'living room lights', 'lounge light', 'lounge lights'],
    transports: ['mock', 'http', 'websocket'],
  },
  {
    id: 'bedroom_lights',
    device: 'lights',
    location: 'bedroom',
    label: 'Bedroom Lights',
    aliases: ['bedroom light', 'bedroom lights', 'bed light', 'bed lights'],
    transports: ['mock', 'http', 'websocket'],
  },
  {
    id: 'living_room_ac',
    device: 'ac',
    location: 'living_room',
    label: 'Living Room AC',
    aliases: ['ac', 'air conditioner', 'aircon', 'living room ac'],
    transports: ['mock', 'http', 'websocket'],
  },
];

export const DEFAULT_LOCATION_BY_DEVICE = {
  fan: 'living_room',
  lights: 'living_room',
  ac: 'living_room',
};

export function buildDeviceStateKey(device, location) {
  return `${location}:${device}`;
}

export function createInitialDeviceStates() {
  return DEVICE_REGISTRY.reduce((deviceStates, entry) => {
    deviceStates[buildDeviceStateKey(entry.device, entry.location)] = 'OFF';
    return deviceStates;
  }, {});
}

export function getDeviceEntry(device, location) {
  return DEVICE_REGISTRY.find(
    (entry) => entry.device === device && entry.location === location
  );
}

export function getDeviceEntriesByDevice(device) {
  return DEVICE_REGISTRY.filter((entry) => entry.device === device);
}

export function getDeviceLabel(device, location) {
  const existingDevice = getDeviceEntry(device, location);

  if (existingDevice) {
    return existingDevice.label;
  }

  const locationLabel = LOCATION_LABELS[location] || 'Unknown Location';
  const deviceLabel = DEVICE_LABELS[device] || device;
  return `${locationLabel} ${deviceLabel}`;
}

export function getTransportName(transport) {
  return DEVICE_TRANSPORT_NAMES[transport] || transport;
}

