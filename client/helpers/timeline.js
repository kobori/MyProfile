/*

Template.timeline.events({
  
  "click #excluir": function(e, template){
    var timeline = this;
    Meteor.call("removeTimeline", timeline._id)
  }
});
*/

Template.timeline.events({
  
  "click #excluir": function(template){
   	var timeline = this;
   	Meteor.call('removeTimeline', timeline._id)
  }
});