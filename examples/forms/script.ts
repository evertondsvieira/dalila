import { signal, createForm, computed } from '../../dist/index.js';
import { bind } from '../../dist/runtime/bind.js';

// ============================================================================
// Basic Form
// ============================================================================

const basicForm = createForm({
  defaultValues: {
    name: '',
    email: '',
    age: undefined
  },
  validate: (data) => {
    const errors: any = {};
    
    if (!data.name || data.name.trim().length === 0) {
      errors.name = 'Name is required';
    }
    
    if (!data.email) {
      errors.email = 'Email is required';
    } else if (!data.email.includes('@')) {
      errors.email = 'Invalid email format';
    }
    
    if (data.age !== undefined && data.age < 18) {
      errors.age = 'Must be 18 or older';
    }
    
    return errors;
  },
  validateOn: 'blur'
});

const basicSuccess = signal(false);
const basicData = signal(JSON.stringify({
  name: '(fill form and submit)',
  email: '...',
  age: '...'
}, null, 2));

async function handleBasicSubmit(data: any, { signal }: any) {
  console.log('Basic form submitted:', data);
  
  // Simulate API call
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (signal.aborted) return;
  basicData.set(JSON.stringify(data, null, 2));
  basicSuccess.set(true);
  setTimeout(() => basicSuccess.set(false), 3000);
}

function resetBasic() {
  basicForm.reset();
  basicSuccess.set(false);
}

const basicSubmitting = basicForm.submitting;
const basicIdle = computed(() => !basicForm.submitting());

// ============================================================================
// Checkbox Form
// ============================================================================

const checkboxForm = createForm({
  defaultValues: {
    agree: false,
    colors: [],
    tags: []
  }
});

const checkboxData = signal(JSON.stringify({
  agree: '(form values live in DOM)',
  colors: '(check boxes to see)',
  tags: '(select options to see)'
}, null, 2));

async function handleCheckboxSubmit(data: any) {
  console.log('Checkbox form submitted:', data);
  
  // Update display with actual submitted data
  checkboxData.set(JSON.stringify(data, null, 2));
}

// ============================================================================
// Field Array Form
// ============================================================================

const arrayForm = createForm({
  defaultValues: {
    contactName: '',
    phones: [
      { number: '', type: 'mobile' },
      { number: '', type: 'home' }
    ]
  },
  validate: (data) => {
    const errors: any = {};
    
    if (data.phones) {
      data.phones.forEach((phone: any, index: number) => {
        if (phone.number && phone.number.length < 10) {
          errors[`phones[${index}].number`] = 'Phone must be at least 10 digits';
        }
      });
    }
    
    return errors;
  }
});

const arrayData = signal(JSON.stringify({
  contactName: '(type in field above)',
  phones: '(add/remove/reorder items)'
}, null, 2));

async function handleArraySubmit(data: any) {
  console.log('Array form submitted:', data);
  arrayData.set(JSON.stringify(data, null, 2));
}

// ============================================================================
// Nested Form
// ============================================================================

const nestedForm = createForm({
  defaultValues: {
    user: {
      name: '',
      email: ''
    },
    address: {
      street: '',
      city: '',
      zip: ''
    }
  },
  validate: (data) => {
    const errors: any = {};
    
    if (!data.user?.name) {
      errors['user.name'] = 'Name is required';
    }
    
    if (!data.user?.email) {
      errors['user.email'] = 'Email is required';
    } else if (!data.user.email.includes('@')) {
      errors['user.email'] = 'Invalid email';
    }
    
    return errors;
  }
});

const nestedData = signal(JSON.stringify({
  user: { name: '...', email: '...' },
  address: { street: '...', city: '...', zip: '...' }
}, null, 2));

async function handleNestedSubmit(data: any) {
  console.log('Nested form submitted:', data);
  nestedData.set(JSON.stringify(data, null, 2));
}

// ============================================================================
// Bind to DOM
// ============================================================================

const ctx = {
  // Basic form
  basicForm,
  handleBasicSubmit,
  resetBasic,
  basicSubmitting,
  basicIdle,
  basicSuccess,
  basicData,
  
  // Checkbox form
  checkboxForm,
  handleCheckboxSubmit,
  checkboxData,
  
  // Array form
  arrayForm,
  handleArraySubmit,
  arrayData,
  
  // Nested form
  nestedForm,
  handleNestedSubmit,
  nestedData
};

bind(document.body, ctx);

console.log('Dalila Forms Examples loaded');
