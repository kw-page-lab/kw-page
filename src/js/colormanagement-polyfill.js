// Polyfill Three.js ColorManagement for backward compatibility with newer compiled loaders
THREE.ColorManagement = {
    enabled: false,
    workingColorSpace: 'srgb',
    convert: (color) => color,
    fromWorkingColorSpace: (color) => color,
    toWorkingColorSpace: (color) => color
};
THREE.SRGBColorSpace = 'srgb';
THREE.LinearSRGBColorSpace = 'linear-srgb';
