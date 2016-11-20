// THE GIST OF ANGULAR 2
// ===========================

// This is a simple educational version of Angular 2, in plain ES6. Though it's just a 
// [working toy](https://timruffles.github.io/gist-of-angular-2), it
// does many things the same way as the real Angular 2 - for instance, it compiles components into
// fast, monomorphic functions by compiling their templates.

// The goal is to implement the hairy 'magic' bits of Angular 2 in code that's as short and readable
// as possible.

// This example is split into 2 parts: framework, and example application.

// First we define the 'gist of ng framework'. The goal is to implement some of NG2's interesting ideas
// in a simplified fashion, to help you understand how components are compiled, templates
// interpreted, and bindings kept up to date. It does not demonstrate all of the concepts of Angular 2 by any means - see the final note.

// Then that comes our application code, which defines component classes just like in NG2. We then call
// bootstrap(...) to kick off the live application.


// 👍 If you enjoy reading this, please let me know below or via @timruffles. There's quite a lot more to write, and I'd
// love to do just that if sufficient numbers of people would find that interesting.


// Part 1: Framework
// ==========================

// Just like NG2's bootstrap, this kicks off an application
// by finding and compiling the root component, then attaching it
// to the DOM.
function bootstrap(RootComponent) {
  const zone = initializeZones();
  const root = compileComponent(RootComponent);
 
  const tag = getTagName(RootComponent.Component);
  const rootEl = document.querySelector(tag);
  if(!rootEl) {
      throw Error(`couldn't find ${tag} element for app bootstrap`);
  }

  attachComponent(rootEl, root, zone);
}

// To get fast components, the information we've gathered
// from the template is used to wire up a class.
// 
// When our component is finally instantiated there is then
// less dynamic behaviour to slow down our operations. For instance,
// each instance is monomorphic as we've compiled a constructor that
// always assigns the same properties for every instance.
function compileComponent(Component) {
  // compilation is a one-time process, so each Component ends up with 
  // a single compiled version, which is used to instantiate our component
  if(Component.compiled) {
    return Component.compiled;
  }

  const { template, components: componentConstructors } = Component.metadata();

  // parse our template, pulling out bindings + any child components
  const templateTreeRoot = document.createElement("root-of-tree");
  templateTreeRoot.innerHTML = template;
  const { bindings, components: attachableComponents } = parseTemplate(templateTreeRoot, componentConstructors);

  // our constructor creates our component instances, and stores them in named instance
  // properties, as well as a array to capture all child instances
  const Compiled = new Function(`
      this.childComponents = [];
      const register = c => { this.childComponents.push(c); return c };
      this.component = new this.Component;
      ${componentProperties()}
  `);

  // give our eval'd function a nice name  
  Object.defineProperty(Compiled, "name", { value: `${Component.name}Compiled`, configurable: true });

  // create a map to store all of our component setups, which also includes their attachment
  // point into the template element
  const childComponentConstructors = new Map(attachableComponents.map((attachable) => {
    const { compiled: { Component: ChildComponent } } = attachable;
    return [ChildComponent.name, ChildComponent];
  }));


  // we're storing everything we need to make instances of our component later on
  Compiled.prototype = {
    Component,
    constructor: Compiled,
  }
  Object.assign(Compiled, {
      bindings, // inputs/outputs (attrs like (click) and [value])
      templateTreeRoot, // our template
      Component, // the component constructor
      attachableComponents, // all child components, with references to nodes in templateTree they're attached to 
      components: childComponentConstructors // a way to lookup our child component's constructors
  });

  
  // now we've compiled our component, store it so we can use the single compiled
  // instance every time 
  Component.compiled = Compiled;
  return Component.compiled;

  // generate code to create a Component instance for each of the components that appear
  // in our template
  function componentProperties() {
    return attachableComponents.map(({ compiled : { Component: { name }}}, i) => 
      `this.component${name}${i} = register(new (this.constructor.components.get('${name}')))`
    ).join("\n");
  }
}

// returns us the components and bindings found in a template, with their
// attachment point into the 'prototype template'
function parseTemplate(el, componentConstructors) {

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);

  // create a lookup table of our components to their respective
  // tag names etc
  const componentNamesToConstructors = new Map(componentConstructors.map(c => [getTagName(c), c]));
  const foundComponents = [];
  const bindings = [];
  let node;

  while(node = walker.nextNode()) {
    const component = componentNamesToConstructors.get(node.tagName);
    if(component) {
        // this is the metadata we need to know we have an instance of a component
        // to attach at a certain point in our template
        foundComponents.push(new AttachableComponent(compileComponent(component), node));
    }

    bindings.push(...gatherBindings(node));
  }
  return { components: foundComponents, bindings};
}

function instantiateTemplate(tpl, attachmentsByEl) {
  return clone(tpl);

  // build a new DOM tree from our source template, running our attachments (bindings + components)
  // as we go
  function clone(sourceEl) {
    const cloned = sourceEl.cloneNode(false);
    // remove children
    cloned.innerHTML = "";
    // continue with children
    Array.from(sourceEl.childNodes)
      .forEach(c => cloned.appendChild(clone(c)));

    (attachmentsByEl.get(sourceEl) || []).forEach(attach => attach(cloned));
    return cloned;
  }
}

// identify bindings - e.g (click) or [value]
function gatherBindings(node) {
  const bindings =[];
  return Array.from(node.attributes).map(attr => {
      const match = /[(\[](\w+)[\])]/.exec(attr.name);
      if(match) {
         return {
             type: match[0][0] === "[" ? 'input' : 'output',
             name: match[1],
             value: attr.value,
             attachTo: node 
         };
      }
  }).filter(n => n)
}


function getTagName(c) {
    return c.name
        .replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b}`)
        .toUpperCase()
}

// takes a compiled component (which includes compiled children), and
// attaches it to the DOM
function attachComponent(el, Compiled, zone) {
    const { bindings, templateTreeRoot, Component } = Compiled;

    const instance = new Compiled;

    // this is the point we introduce the compiled component
    // to its element, and initialize all bindings etc
    instance.nativeEl = el;

    const bindingAttachments = Compiled.bindings.map(binding =>
        [binding.attachTo, binding.type === "input" ? inputAttach(binding, instance, zone) : outputAttach(binding, instance)]
    );

    const componentAttachments = Compiled.attachableComponents.map(({ compiled: ChildComponent, attachTo }) => (
      [attachTo, (attachEl) => {
        attachComponent(attachEl, ChildComponent, zone)
      }]
    ));

    const attachmentsByEl = [...bindingAttachments, ...componentAttachments].reduce((m, [el, attach]) => {
      m.set(el, (m.get(el) || []).concat(attach));
      return m;
    }, new Map);

    // create a new set of DOM nodes from the template...
    const liveEl = instantiateTemplate(Compiled.templateTreeRoot, attachmentsByEl);
    const frag = document.createDocumentFragment();
    Array.from(liveEl.childNodes)
      .forEach(e => frag.appendChild(e));    

    // ...and append where we wish to attach
    el.appendChild(frag);

    return instance;
}

// Toy, incomplete version of zones. Just enough for the demo. The simple summary
// of zones is that we monkey-patch all sources of asynchronousy in the browser to give
// us knowledge of when they're scheduled. Then we can attach listeners to run whatever
// work we need to do to keep our UI up to date (for instance, updating any [...] bindings)
function initializeZones() {

    const zone = { 
        handlers: [],
        onTick(f) { zone.handlers.push(f) },
        tick() { zone.handlers.forEach(f => f()) }
    }

    const listeners = new WeakSet;

    const eal = Element.prototype.addEventListener;
    Element.prototype.addEventListener = function(event, handler) {
      const wrapped = () => { handler(); zone.tick(); };
      listeners.add({ event, handler, wrapped });
      return eal.call(this, event, wrapped)
    }

    const ral = Element.prototype.removeEventListener;
    Element.prototype.removeEventListener = function(eventToRemove, handlerToRemove) {
      for(const record of listeners) {
          const { event, handler, wrapped} = record;
          if(event === eventToRemove && handler === handlerToRemove) {
              listeners.delete(record);
              ral.call(this, event, wrapped);
          }
      }
    }

    return zone;
}

// This is a value object for a component that appears in our template. It stores
// the template node it should be attached to during template instantiation
function AttachableComponent(compiled, attachTo) {
    this.compiled = compiled;
    this.attachTo = attachTo;
}

// takes an expression run against a component, and keeps an attribute up to date with it
function inputAttach(binding, compiled, zone) {
  return function input(attachEl) {
    const fn = new Function('return ' + binding.value).bind(compiled.component);
    const run = () => {
      // need something to make this work with component inputs too
      attachEl.setAttribute(binding.name, fn());
    };
    zone.onTick(run);
    run();
  }
}

// runs an expression when an event occurs
function outputAttach(binding, compiled) {
  return function output(attachEl) {
    attachEl.addEventListener(binding.name, new Function(binding.value).bind(compiled.component));
  }
}


function cl(...args) { console.log(...args)}

// Part 2: our application code, that uses our 'gist of ng2' framework. We define 2 Component classes:
// a simple counter, and our app which demonstrates that we can have a tree of components.


class Counter {
    // To keep things simple I've used a static function instead of decorators to define meta-data
    static metadata() { 
        return {
            components: [],
            template: `
              <h3>Counter</h3>
              <input [value]=this.count >
              <button (click)='this.add()'>Increment</button>
              <button (click)='this.reset()'>Reset</button>
             `
        }
    }

    constructor() {
       this.count = 0;
    }
  
    reset() {
      this.count = 0;
    }

    add() {
      this.count += 1;
    }

}

class App {
    static metadata() { 
        return {
            template: `
                <h2>The gist of Angular 2</h2> 
                <p>This simple demo shows that we have successfully built a tree from a template, with UI elements having their own backing component instances.</p>
                <counter></counter>
                <counter></counter>
                <counter></counter>
            `,
            // like angular 2, we need to explicitly list the components
            // that'll be present in this template
            components: [
                Counter,
            ]
        }
    }
}


// We've defined our app and our framework: kick it off 🎉!
bootstrap(App);
