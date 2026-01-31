import { createApp } from 'vue';
import App from './App.vue';
import { vuetify } from './plugins/vuetify';

// Import styles
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import './assets/main.css';

const app = createApp(App);

app.use(vuetify);

app.mount('#app');
