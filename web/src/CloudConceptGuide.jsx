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
        <h2 id={titleId}>A cloud brings your products and devices together.</h2>
        <p>Define products in your cloud, connect devices to each product, and let end users pair and use those devices through your app.</p>
      </div>
      {actions && <div className="cloud-concept-actions">{actions}</div>}
    </header>
    <figure className="cloud-concept-example">
      <figcaption>How it fits together <span>Example</span></figcaption>
      <div className="cloud-concept-diagram">
        <div className="cloud-concept-actor cloud-concept-team">
          <ConceptIcon name="user-gear" /><strong>Your team</strong>
          <span>Developers &amp; admins</span>
          <div className="cloud-concept-connection">Manage in console <ConceptIcon name="arrow-right" /></div>
        </div>
        <div className="cloud-concept-cloud">
          <div className="cloud-concept-cloud-title"><ConceptIcon name="cloud" /><div><strong>Cloud</strong><span>Acme Cloud</span></div></div>
          <div className="cloud-concept-product">
            <div className="cloud-concept-node"><ConceptIcon name="cubes" /><div><strong>Products</strong><span>Product models &amp; shared settings</span><b>Home Camera</b></div></div>
            <div className="cloud-concept-device-link"><ConceptIcon name="arrow-down" /><span>Devices in this product</span></div>
            <div className="cloud-concept-devices">
              <strong>Devices <span>Physical devices</span></strong>
              <div><span><ConceptIcon name="video" />Camera 001</span><span><ConceptIcon name="video" />Camera 002</span></div>
            </div>
          </div>
        </div>
        <div className="cloud-concept-actor cloud-concept-users">
          <ConceptIcon name="mobile-screen-button" /><strong>End users</strong>
          <span>People using your devices</span>
          <div className="cloud-concept-connection"><ConceptIcon name="arrow-left" /> Pair and use through your app</div>
        </div>
      </div>
    </figure>
    <p className="cloud-concept-roles">Team members manage your cloud in the console. End users pair and use devices through your app.</p>
    <p className="cloud-concept-note">An end user can pair devices from multiple clouds. Each cloud only shows the user&apos;s device relationships within that cloud.</p>
  </section>;
}
