import { translate } from './i18n/index.mjs';
import React, { useId } from 'react';
import './cloud-concept-guide.css';

function ConceptIcon({ name }) {
  return <i className={`fa-solid fa-${name}`} aria-hidden="true" />;
}

export function CloudConceptGuide({ actions }) {
  const titleId = useId();
  return <section className="cloud-concept-guide" aria-labelledby={titleId}>
    <header className="cloud-concept-heading">
      <div>
        <h2 id={titleId}>{translate("A cloud brings your products and devices together.")}</h2>
        <p>{translate("Define products in your cloud, connect devices to each product, and let end users pair and use those devices through your app.")}</p>
      </div>
      {actions && <div className="cloud-concept-actions">{actions}</div>}
    </header>
    <figure className="cloud-concept-example">
      <figcaption>{translate("How it fits together")} <span>{translate("Example")}</span></figcaption>
      <div className="cloud-concept-diagram">
        <div className="cloud-concept-actor cloud-concept-team">
          <ConceptIcon name="user-gear" /><strong>{translate("Your team")}</strong>
          <span>{translate("Developers & admins")}</span>
          <div className="cloud-concept-connection">{translate("Manage in console")} <ConceptIcon name="arrow-right" /></div>
        </div>
        <div className="cloud-concept-cloud">
          <div className="cloud-concept-cloud-title"><ConceptIcon name="cloud" /><div><strong>{translate("Cloud")}</strong><span>{translate("Acme Cloud")}</span></div></div>
          <div className="cloud-concept-product">
            <div className="cloud-concept-node"><ConceptIcon name="cubes" /><div><strong>{translate("Products")}</strong><span>{translate("Product models & shared settings")}</span><b>{translate("Home Camera")}</b></div></div>
            <div className="cloud-concept-device-link"><ConceptIcon name="arrow-down" /><span>{translate("Devices in this product")}</span></div>
            <div className="cloud-concept-devices">
              <strong>{translate("Devices")} <span>{translate("Physical devices")}</span></strong>
              <div><span><ConceptIcon name="video" />{translate("Camera 001")}</span><span><ConceptIcon name="video" />{translate("Camera 002")}</span></div>
            </div>
          </div>
        </div>
        <div className="cloud-concept-actor cloud-concept-users">
          <ConceptIcon name="mobile-screen-button" /><strong>{translate("End users")}</strong>
          <span>{translate("People using your devices")}</span>
          <div className="cloud-concept-connection"><ConceptIcon name="arrow-left" /> {translate("Pair and use through your app")}</div>
        </div>
      </div>
    </figure>
    <p className="cloud-concept-roles">{translate("Team members manage your cloud in the console. End users pair and use devices through your app.")}</p>
    <p className="cloud-concept-note">{translate("An end user can pair devices from multiple clouds. Each cloud only shows the user's device relationships within that cloud.")}</p>
  </section>;
}
