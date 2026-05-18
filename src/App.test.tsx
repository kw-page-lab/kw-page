import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

test('renders loading screen initially', () => {
  render(<App />);
  const loadingElement = screen.getByText(/cargando/i);
  expect(loadingElement).toBeInTheDocument();
});

test('renders app structure correctly', () => {
  render(<App />);
  
  // Should render either loading screen or the main content
  const hasLoadingText = screen.queryByText(/cargando/i);
  const hasComingSoonText = screen.queryByText(/proximamente/i);
  
  // At least one of them should be present
  expect(hasLoadingText || hasComingSoonText).toBeTruthy();
});