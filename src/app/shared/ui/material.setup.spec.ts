import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <button mat-flat-button matTooltip="Acionar difusão">
      <mat-icon fontSet="material-symbols-rounded">siren</mat-icon>
      Acionar
    </button>
  `,
})
class MaterialHost {
  readonly snackBar = inject(MatSnackBar);
}

describe('integração do Angular Material', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MaterialHost] });
  });

  it('monta componentes sem provider de animações', () => {
    const fixture = TestBed.createComponent(MaterialHost);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('button.mat-mdc-button-base')).not.toBeNull();
    expect(host.querySelector('mat-icon')?.textContent?.trim()).toBe('siren');
  });

  it('resolve serviços sobre o overlay do CDK', () => {
    const fixture = TestBed.createComponent(MaterialHost);
    expect(fixture.componentInstance.snackBar).toBeTruthy();
  });
});
