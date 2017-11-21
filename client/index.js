Meteor.startup(function(){

  Meteor.subscribe("posts", function(){
    return Meteor.userId();
    return this.params._id;
  });

  Meteor.subscribe("friendship", function(){
    return Meteor.userId();
    return this.params._id;    
  });


  Meteor.subscribe("isFollowing", function() {
    return Meteor.userId();
    return this.params._id;  
  });


});