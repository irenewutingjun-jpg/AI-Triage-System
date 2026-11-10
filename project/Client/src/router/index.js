import { createRouter, createWebHistory } from 'vue-router'
import PatientView from '../views/PatientView.vue'
import DoctorView from '../views/DoctorView.vue'

const routes = [
  {
    path: '/',
    name: 'Patient',
    component: PatientView
  },
  {
    path: '/doctor',
    name: 'Doctor',
    component: DoctorView
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router