import { defineAbilitiesFor } from '@shared/authorization/ability';

describe('defineAbilitiesFor', () => {
  it('lets admin manage everything', () => {
    const ability = defineAbilitiesFor('admin');

    expect(ability.can('manage', 'all')).toBe(true);
    expect(ability.can('read', 'Kyc')).toBe(true);
    expect(ability.can('update', 'OnboardingFee')).toBe(true);
  });

  it('lets service_provider read/create/update Kyc, CriminalRecord, and OnboardingFee, but not manage all', () => {
    const ability = defineAbilitiesFor('service_provider');

    expect(ability.can('read', 'Kyc')).toBe(true);
    expect(ability.can('create', 'Kyc')).toBe(true);
    expect(ability.can('update', 'CriminalRecord')).toBe(true);
    expect(ability.can('read', 'OnboardingFee')).toBe(true);
    expect(ability.can('manage', 'all')).toBe(false);
    expect(ability.can('read', 'ServiceProviderDirectory')).toBe(false);
  });

  it('lets customer read the service-provider directory but none of the onboarding-module actions', () => {
    const ability = defineAbilitiesFor('customer');

    expect(ability.can('read', 'Kyc')).toBe(false);
    expect(ability.can('read', 'CriminalRecord')).toBe(false);
    expect(ability.can('read', 'OnboardingFee')).toBe(false);
    expect(ability.can('manage', 'all')).toBe(false);
    expect(ability.can('read', 'ServiceProviderDirectory')).toBe(true);
  });
});
