import { AppRouter } from './app/router';
import { Toaster } from '@/components/ui/sonner';

// Initialize i18n (side-effect import)
import './i18n';

function App() {
  return (
    <>
      <AppRouter />
      <Toaster position="top-center" richColors closeButton />
    </>
  );
}

export default App;
