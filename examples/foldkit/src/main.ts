import { Runtime } from 'foldkit';
import { Model, init, update, view } from './app.gtsx';
import './style.css';

const container = document.getElementById('root');
if (!container)
  throw new Error('The Foldkit application container is missing.');

Runtime.run(Runtime.makeApplication({ Model, init, update, view, container }));
