import { createRoot } from 'react-dom/client';
import App from './App';
import { Bubble } from './screens/Bubble';
import { Teleprompter } from './screens/Teleprompter';
import './styles.css';
if (location.hash === '#bubble') { document.body.classList.add('bubble-body'); document.title = 'Tomixel Camera'; }
if (location.hash === '#teleprompter') { document.body.classList.add('teleprompter-body'); document.title = 'Tomixel Teleprompter'; }
createRoot(document.getElementById('root')!).render(location.hash === '#bubble' ? <Bubble /> : location.hash === '#teleprompter' ? <Teleprompter /> : <App />);
