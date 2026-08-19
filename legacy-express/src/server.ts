import { createApp } from './app';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

createApp().listen(PORT, () => {
  console.log(`legacy-express listening on port ${PORT}`);
});
