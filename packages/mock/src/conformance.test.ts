import { describeProviderConformance } from '@calsdk/provider-tests';
import { mockCalendar } from './mock-calendar';

describeProviderConformance({
  name: 'mock',
  createProvider: () => mockCalendar({ calendars: [{ id: 'primary' }] }),
  http: false,
});
