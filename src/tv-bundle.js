import { loadTV } from './tvModel.js';
import { updateScreenManager } from './screenManager.js';

// Expose functions globally to window
window.KimerawareTV = {
  loadTV,
  updateScreenManager
};
